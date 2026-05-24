import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LR_DEV_LOCAL = "1";
});

import { describe, it, expect, beforeEach } from "vitest";
import {
  requireProfileAccess,
  acceptInvite,
  removeMember,
  leaveShare,
  ForbiddenError,
  NotFoundError,
} from "./sharing";
import {
  putProfile,
  putShareLink,
  listProfiles,
  listShareLinks,
  getPartner,
} from "./ddb";
import { _resetDevStore } from "./dev-store";

beforeEach(() => _resetDevStore());

const baseProfile = {
  id: "p1",
  name: "Filho",
  color: "sage" as const,
  createdAt: 1,
};

describe("requireProfileAccess", () => {
  it("owner has all roles", async () => {
    await putProfile("userA", { ...baseProfile, ownerSub: "userA", sharedWith: [], version: 1 });
    await expect(requireProfileAccess("userA", "p1", "owner")).resolves.toBeDefined();
    await expect(requireProfileAccess("userA", "p1", "editor")).resolves.toBeDefined();
    await expect(requireProfileAccess("userA", "p1", "viewer")).resolves.toBeDefined();
  });

  it("partner has editor + viewer, not owner", async () => {
    await putProfile("userA", {
      ...baseProfile, ownerSub: "userA",
      sharedWith: [{ sub: "userB", role: "partner", addedAt: 1 }],
      version: 1,
    });
    await putShareLink("userB", { ownerSub: "userA", profileId: "p1", role: "partner", addedAt: 1 });
    await expect(requireProfileAccess("userB", "p1", "viewer")).resolves.toBeDefined();
    await expect(requireProfileAccess("userB", "p1", "editor")).resolves.toBeDefined();
    await expect(requireProfileAccess("userB", "p1", "owner")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("caregiver has only viewer", async () => {
    await putProfile("userA", {
      ...baseProfile, ownerSub: "userA",
      sharedWith: [{ sub: "userC", role: "caregiver", addedAt: 1 }],
      version: 1,
    });
    await putShareLink("userC", { ownerSub: "userA", profileId: "p1", role: "caregiver", addedAt: 1 });
    await expect(requireProfileAccess("userC", "p1", "viewer")).resolves.toBeDefined();
    await expect(requireProfileAccess("userC", "p1", "editor")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("stranger gets ForbiddenError", async () => {
    await putProfile("userA", { ...baseProfile, ownerSub: "userA", sharedWith: [], version: 1 });
    await expect(requireProfileAccess("userZ", "p1", "viewer")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("stale share link with deleted profile throws NotFoundError", async () => {
    await putShareLink("userD", {
      ownerSub: "userOther", profileId: "deleted-id", role: "caregiver", addedAt: 1,
    });
    await expect(requireProfileAccess("userD", "deleted-id", "viewer")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("acceptInvite", () => {
  it("caregiver mode adds entry to sharedWith and writes link record", async () => {
    await putProfile("ownerA", { ...baseProfile, ownerSub: "ownerA", sharedWith: [], version: 1 });

    await acceptInvite({
      callerSub: "caregiverB",
      callerEmail: "b@example.com",
      callerName: "B",
      payload: {
        ownerSub: "ownerA",
        mode: "caregiver",
        profileIds: ["p1"],
        inviteeEmail: "b@example.com",
      },
    });

    const updated = await listProfiles("ownerA");
    expect(updated[0].sharedWith).toContainEqual(
      expect.objectContaining({ sub: "caregiverB", role: "caregiver" }),
    );
    expect(updated[0].version).toBe(2);

    const links = await listShareLinks("caregiverB");
    expect(links).toContainEqual(expect.objectContaining({ profileId: "p1" }));
  });

  it("partner mode writes partner record on both sides + shares all profiles", async () => {
    await putProfile("ownerA", { ...baseProfile, ownerSub: "ownerA", sharedWith: [], version: 1 });

    await acceptInvite({
      callerSub: "partnerB",
      callerEmail: "b@example.com",
      callerName: "B",
      payload: { ownerSub: "ownerA", mode: "partner", inviteeEmail: "b@example.com" },
    });

    expect((await getPartner("ownerA"))?.partnerSub).toBe("partnerB");
    expect((await getPartner("partnerB"))?.partnerSub).toBe("ownerA");

    const updated = await listProfiles("ownerA");
    expect(updated[0].sharedWith[0]).toEqual(
      expect.objectContaining({ sub: "partnerB", role: "partner" }),
    );
  });

  it("rejects when inviteeEmail mismatches", async () => {
    await expect(
      acceptInvite({
        callerSub: "wrongUser",
        callerEmail: "wrong@example.com",
        callerName: "W",
        payload: {
          ownerSub: "ownerA",
          mode: "caregiver",
          profileIds: ["p1"],
          inviteeEmail: "expected@example.com",
        },
      }),
    ).rejects.toThrow(/inviteeEmail/);
  });

  it("rejects partner invite missing inviteeEmail (email-bound for both modes)", async () => {
    await putProfile("ownerA", { ...baseProfile, ownerSub: "ownerA", sharedWith: [], version: 1 });
    await expect(
      acceptInvite({
        callerSub: "partnerB",
        callerEmail: "b@example.com",
        callerName: "B",
        payload: { ownerSub: "ownerA", mode: "partner" },
      }),
    ).rejects.toThrow(/inviteeEmail/);
  });

  it("rejects a second partner on the caller's side", async () => {
    await putProfile("ownerA", { ...baseProfile, ownerSub: "ownerA", sharedWith: [], version: 1 });
    await putProfile("ownerB", { ...baseProfile, id: "p2", ownerSub: "ownerB", sharedWith: [], version: 1 });

    // caller links to ownerA first
    await acceptInvite({
      callerSub: "callerX",
      callerEmail: "x@example.com",
      callerName: "X",
      payload: { ownerSub: "ownerA", mode: "partner", inviteeEmail: "x@example.com" },
    });

    // a second partner invite (from ownerB) must be rejected
    await expect(
      acceptInvite({
        callerSub: "callerX",
        callerEmail: "x@example.com",
        callerName: "X",
        payload: { ownerSub: "ownerB", mode: "partner", inviteeEmail: "x@example.com" },
      }),
    ).rejects.toThrow(/parceiro/);
  });

  it("rejects when the invite owner already has a different partner", async () => {
    await putProfile("ownerA", { ...baseProfile, ownerSub: "ownerA", sharedWith: [], version: 1 });

    // ownerA already paired with someoneElse
    await acceptInvite({
      callerSub: "someoneElse",
      callerEmail: "se@example.com",
      callerName: "SE",
      payload: { ownerSub: "ownerA", mode: "partner", inviteeEmail: "se@example.com" },
    });

    // a new caller trying to become ownerA's partner must be rejected
    await expect(
      acceptInvite({
        callerSub: "newCaller",
        callerEmail: "nc@example.com",
        callerName: "NC",
        payload: { ownerSub: "ownerA", mode: "partner", inviteeEmail: "nc@example.com" },
      }),
    ).rejects.toThrow(/parceiro/);
  });
});

describe("removeMember / leaveShare", () => {
  it("owner can remove caregiver", async () => {
    await putProfile("ownerA", {
      ...baseProfile, ownerSub: "ownerA",
      sharedWith: [{ sub: "carerB", role: "caregiver", addedAt: 1 }],
      version: 2,
    });
    await putShareLink("carerB", { ownerSub: "ownerA", profileId: "p1", role: "caregiver", addedAt: 1 });

    await removeMember({ callerSub: "ownerA", profileId: "p1", memberSub: "carerB" });

    const updated = await listProfiles("ownerA");
    expect(updated[0].sharedWith).toEqual([]);
    expect(await listShareLinks("carerB")).toEqual([]);
  });

  it("non-owner cannot remove other members", async () => {
    await putProfile("ownerA", {
      ...baseProfile, ownerSub: "ownerA",
      sharedWith: [
        { sub: "carerB", role: "caregiver", addedAt: 1 },
        { sub: "carerC", role: "caregiver", addedAt: 1 },
      ],
      version: 2,
    });
    await putShareLink("carerB", { ownerSub: "ownerA", profileId: "p1", role: "caregiver", addedAt: 1 });
    await expect(
      removeMember({ callerSub: "carerB", profileId: "p1", memberSub: "carerC" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("leaveShare removes caller from sharedWith and their link record", async () => {
    await putProfile("ownerA", {
      ...baseProfile, ownerSub: "ownerA",
      sharedWith: [{ sub: "carerB", role: "caregiver", addedAt: 1 }],
      version: 2,
    });
    await putShareLink("carerB", { ownerSub: "ownerA", profileId: "p1", role: "caregiver", addedAt: 1 });

    await leaveShare({ callerSub: "carerB", ownerSub: "ownerA", profileId: "p1" });

    expect((await listProfiles("ownerA"))[0].sharedWith).toEqual([]);
    expect(await listShareLinks("carerB")).toEqual([]);
  });

  it("leaveShare by a caller with no share link does NOT mutate the target profile (IDOR)", async () => {
    // ownerA shares p1 with the legitimate member carerB.
    await putProfile("ownerA", {
      ...baseProfile, ownerSub: "ownerA",
      sharedWith: [{ sub: "carerB", role: "caregiver", addedAt: 1 }],
      version: 2,
    });
    await putShareLink("carerB", { ownerSub: "ownerA", profileId: "p1", role: "caregiver", addedAt: 1 });

    // attackerZ has no share link but tries to "leave" ownerA's profile.
    await leaveShare({ callerSub: "attackerZ", ownerSub: "ownerA", profileId: "p1" });

    // The profile's sharedWith must be untouched (carerB still there, version unchanged).
    const after = (await listProfiles("ownerA"))[0];
    expect(after.sharedWith).toEqual([{ sub: "carerB", role: "caregiver", addedAt: 1 }]);
    expect(after.version).toBe(2);
  });
});
