import { vi } from "vitest";
// Set env before importing ddb so it picks dev-store at module load.
vi.hoisted(() => {
  process.env.LR_DEV_LOCAL = "1";
});

import { describe, it, expect, beforeEach } from "vitest";
import {
  listRemindersForProfile,
  putReminderForProfile,
  deleteReminderForProfile,
  getLogForProfile,
  setLogEntryForProfile,
  markNotifiedForProfile,
  getNotifiedKeysForProfile,
  putProfile,
  listProfiles,
  listProfilesForUser,
  putShareLink,
  setPartner,
  getPartner,
  deletePartner,
  putPairToken,
  consumePairToken,
  putGenericToken,
  consumeGenericToken,
} from "./ddb";
import { _resetDevStore } from "./dev-store";

beforeEach(() => _resetDevStore());

describe("profile-scoped DDB helpers", () => {
  it("listReminders returns only reminders in the profile partition", async () => {
    await putReminderForProfile({
      id: "r1", kind: "medication", title: "Dipirona",
      schedule: { type: "daily-interval", intervalHours: 8, startTime: "08:00" },
      profileId: "p1", createdAt: 1,
    });
    await putReminderForProfile({
      id: "r2", kind: "medication", title: "Outro",
      schedule: { type: "daily-interval", intervalHours: 12, startTime: "09:00" },
      profileId: "p2", createdAt: 2,
    });
    const list = await listRemindersForProfile("p1");
    expect(list.map((r) => r.id)).toEqual(["r1"]);
  });

  it("setLogEntry + getLog record takenBy", async () => {
    await setLogEntryForProfile("p1", "2026-05-24", "r1@08:00", true, "userA");
    const log = await getLogForProfile("p1", "2026-05-24");
    expect(log["r1@08:00"].taken).toBe(true);
    expect(log["r1@08:00"].takenBy).toBe("userA");
  });

  it("markNotified is atomic per profile+date+key", async () => {
    const first = await markNotifiedForProfile("p1", "2026-05-24", "r1@08:00");
    const second = await markNotifiedForProfile("p1", "2026-05-24", "r1@08:00");
    expect(first).toBe(true);
    expect(second).toBe(false);
    const keys = await getNotifiedKeysForProfile("p1", "2026-05-24");
    expect(keys.has("r1@08:00")).toBe(true);
  });

  it("deleteReminder removes from profile partition", async () => {
    await putReminderForProfile({
      id: "r1", kind: "medication", title: "X",
      schedule: { type: "daily-interval", intervalHours: 8, startTime: "08:00" },
      profileId: "p1", createdAt: 1,
    });
    await deleteReminderForProfile("p1", "r1");
    expect(await listRemindersForProfile("p1")).toEqual([]);
  });
});

describe("pair/generic token namespaces", () => {
  it("consumeGenericToken cannot burn a Telegram pair token", async () => {
    await putPairToken("tok-tg", "userA", 3600);
    expect(await consumeGenericToken("tok-tg")).toBeNull();
    // The Telegram token is still consumable via its own flow.
    expect(await consumePairToken("tok-tg")).toBe("userA");
  });

  it("consumePairToken cannot burn a generic sharing token", async () => {
    await putGenericToken("tok-share", JSON.stringify({ ownerSub: "x" }), 3600);
    expect(await consumePairToken("tok-share")).toBeNull();
    // The generic token is still consumable via its own flow.
    expect(await consumeGenericToken("tok-share")).toBe(JSON.stringify({ ownerSub: "x" }));
  });
});

describe("profile metadata + sharing", () => {
  it("putProfile sets ownerSub/sharedWith/version when missing", async () => {
    await putProfile("userA", {
      id: "p1", name: "Filho", color: "sage", createdAt: 1,
      ownerSub: "userA", sharedWith: [], version: 1,
    });
    const profs = await listProfiles("userA");
    expect(profs[0].ownerSub).toBe("userA");
    expect(profs[0].version).toBe(1);
  });

  it("putProfile dedups sharedWith by sub (keeps last entry)", async () => {
    await putProfile("userA", {
      id: "p1", name: "Filho", color: "sage", createdAt: 1,
      ownerSub: "userA",
      sharedWith: [
        { sub: "userB", role: "caregiver", addedAt: 1 },
        { sub: "userB", role: "partner", addedAt: 2 },
      ],
      version: 1,
    });
    const profs = await listProfiles("userA");
    expect(profs[0].sharedWith).toEqual([{ sub: "userB", role: "partner", addedAt: 2 }]);
  });

  it("listProfilesForUser merges own + shared via link records", async () => {
    await putProfile("userA", {
      id: "p1", name: "Filho", color: "sage", createdAt: 1,
      ownerSub: "userA",
      sharedWith: [{ sub: "userB", role: "caregiver", addedAt: 2 }],
      version: 1,
    });
    await putShareLink("userB", {
      ownerSub: "userA", profileId: "p1", role: "caregiver", addedAt: 2,
    });

    const merged = await listProfilesForUser("userB");
    expect(merged.length).toBe(1);
    expect(merged[0].profile.id).toBe("p1");
    expect(merged[0].accessRole).toBe("caregiver");
  });

  it("partner record CRUD", async () => {
    await setPartner("userA", {
      partnerSub: "userB", partnerEmail: "b@example.com", partnerName: "B", since: 1,
    });
    expect((await getPartner("userA"))?.partnerSub).toBe("userB");
    await deletePartner("userA");
    expect(await getPartner("userA")).toBeNull();
  });
});
