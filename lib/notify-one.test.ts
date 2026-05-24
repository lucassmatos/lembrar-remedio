/**
 * Unit tests for notify-one.ts (profile-scoped fan-out).
 *
 * Strategy:
 * - Use LR_DEV_LOCAL=1 so ddb helpers hit the in-memory dev-store.
 * - vi.mock("./telegram") so sendMessage never hits the network.
 * - Pre-populate the dev-store with profile metadata + reminders via ddb helpers.
 */
import { vi } from "vitest";

// Activate dev-store BEFORE any ddb imports resolve the doc reference.
vi.hoisted(() => {
  process.env.LR_DEV_LOCAL = "1";
});

// Mock telegram before importing notify-one (which imports telegram).
vi.mock("./telegram", () => ({
  sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
  escapeHtml: (s: string) => s,
}));

import { describe, it, expect, beforeEach } from "vitest";
import { _resetDevStore } from "./dev-store";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { notifyOneDose } from "./notify-one";
import { setConfig, _internal } from "./ddb";
import type { Reminder } from "./types";
import { sendMessage } from "./telegram";

const { PK, SK, doc, TABLE } = _internal;

const OWNER_SUB = "owner-1";
const VIEWER_SUB = "viewer-1";
const PROFILE_ID = "prof-1";
const REMINDER_ID = "med-1";

// Use UTC timezone: date = today in UTC, which equals NOW_DATE.
const TZ = "UTC";
const NOW_DATE = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD" in UTC

async function seedProfile(opts: {
  ownerSub: string;
  profileId: string;
  name: string;
  sharedWith?: Array<{ sub: string; role: string }>;
}) {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK.user(opts.ownerSub),
        sk: SK.profile(opts.profileId),
        id: opts.profileId,
        name: opts.name,
        ownerSub: opts.ownerSub,
        sharedWith: opts.sharedWith ?? [],
        color: "sage",
        isDefault: true,
        createdAt: Date.now(),
        version: 1,
      },
    }),
  );
  // Also write the meta sentinel.
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK.profile(opts.profileId),
        sk: "meta",
        ownerSub: opts.ownerSub,
        profileId: opts.profileId,
      },
    }),
  );
}

async function seedReminder(profileId: string, reminder: Partial<Reminder> & { id: string }) {
  const full: Reminder = {
    kind: "medication",
    title: "Test Med",
    profileId,
    createdAt: Date.now(),
    schedule: { type: "daily-interval", intervalHours: 24, startTime: "08:00", times: ["08:00"] },
    ...reminder,
  };
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK.profile(profileId),
        sk: SK.reminder(full.id),
        ...full,
      },
    }),
  );
}

beforeEach(() => {
  _resetDevStore();
  vi.mocked(sendMessage).mockClear();
  vi.mocked(sendMessage).mockResolvedValue({ message_id: 42 });
});

describe("notifyOneDose — med-slot", () => {
  it("returns sent:false when reminder is missing", async () => {
    await seedProfile({ ownerSub: OWNER_SUB, profileId: PROFILE_ID, name: "Família" });
    await setConfig(OWNER_SUB, { timezone: TZ, chatId: 1001 });

    const result = await notifyOneDose({
      profileId: PROFILE_ID,
      ownerSub: OWNER_SUB,
      reminderId: "nonexistent",
      time: "08:00",
    });
    expect(result).toEqual({ sent: false, reason: "reminder deleted" });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends to owner only when no shared members", async () => {
    await seedProfile({ ownerSub: OWNER_SUB, profileId: PROFILE_ID, name: "Família" });
    await seedReminder(PROFILE_ID, { id: REMINDER_ID });
    await setConfig(OWNER_SUB, { timezone: TZ, chatId: 1001 });

    const result = await notifyOneDose({
      profileId: PROFILE_ID,
      ownerSub: OWNER_SUB,
      reminderId: REMINDER_ID,
      time: "08:00",
    });

    expect(result).toMatchObject({ sent: true, key: `${REMINDER_ID}@08:00` });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 1001 }),
    );
  });

  it("fans out to all members with chatIds (2-member profile)", async () => {
    await seedProfile({
      ownerSub: OWNER_SUB,
      profileId: PROFILE_ID,
      name: "Família",
      sharedWith: [{ sub: VIEWER_SUB, role: "caregiver" }],
    });
    await seedReminder(PROFILE_ID, { id: REMINDER_ID });
    await setConfig(OWNER_SUB, { timezone: TZ, chatId: 1001 });
    await setConfig(VIEWER_SUB, { timezone: TZ, chatId: 2002 });

    const result = await notifyOneDose({
      profileId: PROFILE_ID,
      ownerSub: OWNER_SUB,
      reminderId: REMINDER_ID,
      time: "08:00",
    });

    expect(result).toMatchObject({ sent: true });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    const chatIds = vi.mocked(sendMessage).mock.calls.map((c) => c[0].chatId).sort();
    expect(chatIds).toEqual([1001, 2002]);
  });

  it("skips member without chatId", async () => {
    await seedProfile({
      ownerSub: OWNER_SUB,
      profileId: PROFILE_ID,
      name: "Família",
      sharedWith: [{ sub: VIEWER_SUB, role: "caregiver" }],
    });
    await seedReminder(PROFILE_ID, { id: REMINDER_ID });
    await setConfig(OWNER_SUB, { timezone: TZ, chatId: 1001 });
    // VIEWER_SUB has no chatId — getConfig returns default without chatId.

    const result = await notifyOneDose({
      profileId: PROFILE_ID,
      ownerSub: OWNER_SUB,
      reminderId: REMINDER_ID,
      time: "08:00",
    });

    expect(result).toMatchObject({ sent: true });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ chatId: 1001 }));
  });

  it("returns sent:true (claim won) even when no member has a chatId", async () => {
    await seedProfile({ ownerSub: OWNER_SUB, profileId: PROFILE_ID, name: "Solo" });
    await seedReminder(PROFILE_ID, { id: REMINDER_ID });
    // No chatId for owner.

    const result = await notifyOneDose({
      profileId: PROFILE_ID,
      ownerSub: OWNER_SUB,
      reminderId: REMINDER_ID,
      time: "08:00",
    });

    // Claim is won (slot is atomically marked), even though nobody was messaged.
    expect(result).toMatchObject({ sent: true, key: `${REMINDER_ID}@08:00` });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("deduplicates: second call returns already notified", async () => {
    await seedProfile({ ownerSub: OWNER_SUB, profileId: PROFILE_ID, name: "Família" });
    await seedReminder(PROFILE_ID, { id: REMINDER_ID });
    await setConfig(OWNER_SUB, { timezone: TZ, chatId: 1001 });

    const first = await notifyOneDose({
      profileId: PROFILE_ID,
      ownerSub: OWNER_SUB,
      reminderId: REMINDER_ID,
      time: "08:00",
    });
    expect(first).toMatchObject({ sent: true });

    const second = await notifyOneDose({
      profileId: PROFILE_ID,
      ownerSub: OWNER_SUB,
      reminderId: REMINDER_ID,
      time: "08:00",
    });
    expect(second).toEqual({ sent: false, reason: "already notified" });
    // sendMessage called only once (first invocation).
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("persists messageIds into notified record after sending", async () => {
    await seedProfile({
      ownerSub: OWNER_SUB,
      profileId: PROFILE_ID,
      name: "Família",
      sharedWith: [{ sub: VIEWER_SUB, role: "caregiver" }],
    });
    await seedReminder(PROFILE_ID, { id: REMINDER_ID });
    await setConfig(OWNER_SUB, { timezone: TZ, chatId: 1001 });
    await setConfig(VIEWER_SUB, { timezone: TZ, chatId: 2002 });

    // sendMessage returns message_id: 42 for all calls (mock default).
    await notifyOneDose({
      profileId: PROFILE_ID,
      ownerSub: OWNER_SUB,
      reminderId: REMINDER_ID,
      time: "08:00",
    });

    // Read the notified record from dev-store and verify messages map was written.
    const res = await doc.send(
      new GetCommand({
        TableName: TABLE,
        Key: { pk: PK.profile(PROFILE_ID), sk: SK.notified(NOW_DATE) },
      }),
    );
    const item = res.Item as Record<string, unknown> | undefined;
    expect(item).toBeDefined();
    const messages = item?.messages as Record<string, unknown> | undefined;
    expect(messages).toBeDefined();
    // There should be 2 entries — one per member.
    expect(Object.keys(messages ?? {}).length).toBe(2);
  });

  it("returns already taken when log entry exists", async () => {
    await seedProfile({ ownerSub: OWNER_SUB, profileId: PROFILE_ID, name: "Família" });
    await seedReminder(PROFILE_ID, { id: REMINDER_ID });
    await setConfig(OWNER_SUB, { timezone: TZ, chatId: 1001 });

    // Pre-seed a taken log entry.
    await doc.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          pk: PK.profile(PROFILE_ID),
          sk: SK.log(NOW_DATE),
          [`${REMINDER_ID}@08:00`]: { taken: true, takenAt: Date.now() },
        },
      }),
    );

    const result = await notifyOneDose({
      profileId: PROFILE_ID,
      ownerSub: OWNER_SUB,
      reminderId: REMINDER_ID,
      time: "08:00",
    });
    expect(result).toEqual({ sent: false, reason: "already taken" });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
