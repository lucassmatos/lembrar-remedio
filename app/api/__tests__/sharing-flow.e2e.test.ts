import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LR_DEV_LOCAL = "1";
});

import { describe, it, expect, beforeEach } from "vitest";
import { _resetDevStore } from "../../../lib/dev-store";
import {
  putProfile,
  putReminderForProfile,
  putGenericToken,
  consumeGenericToken,
  listProfilesForUser,
  listShareLinks,
  getPartner,
  setLogEntryForProfile,
  getLogForProfile,
} from "../../../lib/ddb";
import {
  acceptInvite,
  requireProfileAccess,
  removeMember,
  ForbiddenError,
} from "../../../lib/sharing";
import type { InvitePayload } from "../../../lib/sharing";

beforeEach(() => _resetDevStore());

// Shared test fixtures
const baseProfile = {
  name: "Filho",
  color: "sage" as const,
  createdAt: 1,
};

describe("sharing-flow e2e — full backend integration", () => {
  it("E1+E3: caregiver flow — invite, accept, access, remove", async () => {
    // 1. ownerA creates profile p1 + reminder
    await putProfile("ownerA", {
      id: "p1",
      ...baseProfile,
      ownerSub: "ownerA",
      sharedWith: [],
      version: 1,
    });
    await putReminderForProfile({
      id: "r1",
      kind: "medication",
      title: "Dipirona",
      schedule: { type: "daily-interval", intervalHours: 8, startTime: "08:00" },
      profileId: "p1",
      createdAt: 1,
    });

    // 2. ownerA generates a caregiver invite token
    const payload: InvitePayload = {
      ownerSub: "ownerA",
      mode: "caregiver",
      profileIds: ["p1"],
      inviteeEmail: "carerB@example.com",
    };
    const token = "test-caregiver-token-1234";
    await putGenericToken(token, JSON.stringify(payload), 86400);

    // 3. caregiverB consumes token + acceptInvite
    const payloadJson = await consumeGenericToken(token);
    expect(payloadJson).not.toBeNull();
    const parsedPayload: InvitePayload = JSON.parse(payloadJson!);
    await acceptInvite({
      callerSub: "caregiverB",
      callerEmail: "carerB@example.com",
      callerName: "Carer B",
      payload: parsedPayload,
    });

    // 4. caregiverB sees p1 via listProfilesForUser
    const caregiverProfiles = await listProfilesForUser("caregiverB");
    expect(caregiverProfiles).toHaveLength(1);
    expect(caregiverProfiles[0].profile.id).toBe("p1");
    expect(caregiverProfiles[0].accessRole).toBe("caregiver");

    // 5. caregiverB can mark dose (requireProfileAccess viewer)
    const viewGrant = await requireProfileAccess("caregiverB", "p1", "viewer");
    expect(viewGrant.profile.id).toBe("p1");

    // ... mark the dose
    await setLogEntryForProfile("p1", "2026-05-24", "r1@08:00", true, "caregiverB");
    const log = await getLogForProfile("p1", "2026-05-24");
    expect(log["r1@08:00"].taken).toBe(true);
    expect(log["r1@08:00"].takenBy).toBe("caregiverB");

    // 6. caregiverB CANNOT edit (requireProfileAccess editor throws)
    await expect(requireProfileAccess("caregiverB", "p1", "editor")).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // 7. ownerA removeMember(caregiverB) → caregiverB no longer sees p1
    await removeMember({ callerSub: "ownerA", profileId: "p1", memberSub: "caregiverB" });

    const afterRemove = await listProfilesForUser("caregiverB");
    expect(afterRemove).toHaveLength(0);

    const links = await listShareLinks("caregiverB");
    expect(links).toHaveLength(0);
  });

  it("E1+E3: partner flow — invite, accept, both have partner records, partner can edit", async () => {
    // ownerA creates profile
    await putProfile("ownerA", {
      id: "p1",
      ...baseProfile,
      ownerSub: "ownerA",
      sharedWith: [],
      version: 1,
    });

    // ownerA creates an email-bound partner invite token
    const payload: InvitePayload = {
      ownerSub: "ownerA",
      mode: "partner",
      inviteeEmail: "partner@example.com",
    };
    const token = "test-partner-token-5678";
    await putGenericToken(token, JSON.stringify(payload), 86400);

    // partnerC consumes token + accepts
    const payloadJson = await consumeGenericToken(token);
    expect(payloadJson).not.toBeNull();
    const parsedPayload: InvitePayload = JSON.parse(payloadJson!);
    await acceptInvite({
      callerSub: "partnerC",
      callerEmail: "partner@example.com",
      callerName: "Partner C",
      payload: parsedPayload,
    });

    // Both have partner records
    const ownerPartner = await getPartner("ownerA");
    expect(ownerPartner?.partnerSub).toBe("partnerC");

    const callerPartner = await getPartner("partnerC");
    expect(callerPartner?.partnerSub).toBe("ownerA");

    // partnerC can see p1 and edit it
    const partnerProfiles = await listProfilesForUser("partnerC");
    expect(partnerProfiles).toHaveLength(1);
    expect(partnerProfiles[0].profile.id).toBe("p1");
    expect(partnerProfiles[0].accessRole).toBe("partner");

    await expect(requireProfileAccess("partnerC", "p1", "editor")).resolves.toBeDefined();
  });

  it("consumeGenericToken is single-use — second call returns null", async () => {
    const token = "single-use-token-abc";
    await putGenericToken(token, JSON.stringify({ ownerSub: "x", mode: "partner" }), 86400);

    const first = await consumeGenericToken(token);
    expect(first).not.toBeNull();

    const second = await consumeGenericToken(token);
    expect(second).toBeNull();
  });

  it("consumeGenericToken returns null for missing token", async () => {
    const result = await consumeGenericToken("nonexistent-token");
    expect(result).toBeNull();
  });

  it("consumeGenericToken rejects Telegram pair tokens (wrong kind)", async () => {
    // Telegram tokens are put with putPairToken (no kind field) — consumeGenericToken
    // should reject them due to the #kind = :kind condition
    const { _internal } = await import("../../../lib/ddb");
    const { PK, SK, doc, TABLE } = _internal;
    const { PutCommand } = await import("@aws-sdk/lib-dynamodb");

    // Simulate a Telegram pair token (has no kind field)
    await doc.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          pk: PK.pair("telegram-token-xyz"),
          sk: SK.pair,
          sub: "userA",
          ttl: Math.floor(Date.now() / 1000) + 86400,
        },
      }),
    );

    // consumeGenericToken should return null since kind != "generic"
    const result = await consumeGenericToken("telegram-token-xyz");
    expect(result).toBeNull();
  });
});
