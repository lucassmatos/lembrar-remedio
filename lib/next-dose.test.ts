import { describe, it, expect } from "vitest";
import { computeNextDose, epochMsForTzDateTime, type NextDoseDeps } from "./next-dose";
import type { Config, DayLog, Reminder } from "./types";

const TZ = "America/Sao_Paulo"; // UTC-3, no DST

// Reference moment: 2026-05-24T08:00:00 in São Paulo = 2026-05-24T11:00:00Z
const NOW = Date.UTC(2026, 4, 24, 11, 0, 0);

const TARGET = { profileId: "p1", ownerSub: "u1" };

function mkDeps(opts: {
  config?: Partial<Config>;
  reminders?: Reminder[];
  logs?: Record<string, DayLog>;
  notified?: Record<string, string[]>;
}): NextDoseDeps {
  return {
    async getConfig() {
      return { timezone: TZ, ...opts.config };
    },
    async listReminders() {
      return opts.reminders ?? [];
    },
    async getLog(_profileId, date) {
      return opts.logs?.[date] ?? {};
    },
    async getNotifiedKeys(_profileId, date) {
      return new Set(opts.notified?.[date] ?? []);
    },
  };
}

function dailyMed(over: Partial<Reminder> & { times: string[] }): Reminder {
  const { times, ...rest } = over;
  return {
    id: "m1",
    kind: "medication",
    title: "Test Med",
    profileId: "p1",
    createdAt: NOW - 86_400_000,
    schedule: {
      type: "daily-interval",
      intervalHours: 24,
      startTime: times[0],
      times,
    },
    ...rest,
  };
}

describe("epochMsForTzDateTime", () => {
  it("computes São Paulo 08:00 as 11:00 UTC", () => {
    const ms = epochMsForTzDateTime("2026-05-24", "08:00", TZ);
    expect(ms).toBe(Date.UTC(2026, 4, 24, 11, 0, 0));
  });

  it("computes UTC 08:00 as 08:00 UTC", () => {
    const ms = epochMsForTzDateTime("2026-05-24", "08:00", "UTC");
    expect(ms).toBe(Date.UTC(2026, 4, 24, 8, 0, 0));
  });

  it("returns null for malformed date", () => {
    expect(epochMsForTzDateTime("2026-5-24", "08:00", TZ)).toBeNull();
    expect(epochMsForTzDateTime("not-a-date", "08:00", TZ)).toBeNull();
  });

  it("returns null for malformed time", () => {
    expect(epochMsForTzDateTime("2026-05-24", "8:00", TZ)).toBeNull();
    expect(epochMsForTzDateTime("2026-05-24", "25:00", TZ)).toBeNull();
    expect(epochMsForTzDateTime("2026-05-24", "08:60", TZ)).toBeNull();
  });

  it("handles New York DST (spring forward March 8 2026)", () => {
    // Before DST: standard offset is -5h
    const before = epochMsForTzDateTime("2026-03-07", "12:00", "America/New_York");
    expect(before).toBe(Date.UTC(2026, 2, 7, 17, 0, 0));
    // After DST: offset is -4h
    const after = epochMsForTzDateTime("2026-03-09", "12:00", "America/New_York");
    expect(after).toBe(Date.UTC(2026, 2, 9, 16, 0, 0));
  });
});

describe("computeNextDose", () => {
  it("returns empty when no reminders", async () => {
    const deps = mkDeps({ reminders: [] });
    const result = await computeNextDose(TARGET, deps, { now: NOW });
    expect(result).toEqual({ due: [], nextAt: null });
  });

  it("picks today's future slot as nextAt", async () => {
    // Now = 08:00 SP. Slot at 14:00 SP today = next.
    const reminders = [dailyMed({ times: ["14:00"] })];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    expect(result.due).toEqual([]);
    expect(result.nextAt).toBe(epochMsForTzDateTime("2026-05-24", "14:00", TZ));
  });

  it("rolls to tomorrow when no slot left today", async () => {
    // Now = 08:00 SP. Slot at 06:00 SP today is past the catch-up window → tomorrow's slot.
    const reminders = [dailyMed({ times: ["06:00"] })];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    expect(result.due).toEqual([]);
    expect(result.nextAt).toBe(epochMsForTzDateTime("2026-05-25", "06:00", TZ));
  });

  it("returns slot as due when it's within fire-fudge window", async () => {
    // Slot exactly at NOW.
    const reminders = [dailyMed({ times: ["08:00"] })];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    expect(result.due).toEqual([
      { profileId: "p1", ownerSub: "u1", reminderId: "m1", time: "08:00" },
    ]);
    // Next is tomorrow at 08:00.
    expect(result.nextAt).toBe(epochMsForTzDateTime("2026-05-25", "08:00", TZ));
  });

  it("includes slot from last few minutes in due", async () => {
    // Slot at 07:58 SP = 4 minutes ago.
    const reminders = [dailyMed({ times: ["07:58"] })];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    expect(result.due).toEqual([
      { profileId: "p1", ownerSub: "u1", reminderId: "m1", time: "07:58" },
    ]);
  });

  it("recovers a slot fired up to an hour late (regression: late dispatch)", async () => {
    // Slot at 07:15 SP = 45 minutes ago. With the old 5min window this dropped
    // silently (the migration bug that ate the 19:00 doses). The 60min catch-up
    // must still deliver it.
    const reminders = [dailyMed({ times: ["07:15"] })];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    expect(result.due).toEqual([
      { profileId: "p1", ownerSub: "u1", reminderId: "m1", time: "07:15" },
    ]);
  });

  it("excludes slot older than catch-up window", async () => {
    // Slot at 06:30 SP = 90 minutes ago, beyond the 60min catch-up.
    const reminders = [dailyMed({ times: ["06:30"] })];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    expect(result.due).toEqual([]);
    expect(result.nextAt).toBe(epochMsForTzDateTime("2026-05-25", "06:30", TZ));
  });

  it("filters slots already taken from log", async () => {
    const reminders = [dailyMed({ times: ["14:00"] })];
    const deps = mkDeps({
      reminders,
      logs: { "2026-05-24": { "m1@14:00": { taken: true, takenAt: NOW } } },
    });
    const result = await computeNextDose(TARGET, deps, { now: NOW });
    // Should skip today's 14:00, fall through to tomorrow's 14:00.
    expect(result.nextAt).toBe(epochMsForTzDateTime("2026-05-25", "14:00", TZ));
  });

  it("filters slots already notified", async () => {
    const reminders = [dailyMed({ times: ["14:00"] })];
    const deps = mkDeps({
      reminders,
      notified: { "2026-05-24": ["m1@14:00"] },
    });
    const result = await computeNextDose(TARGET, deps, { now: NOW });
    expect(result.nextAt).toBe(epochMsForTzDateTime("2026-05-25", "14:00", TZ));
  });

  it("respects startDate (future)", async () => {
    const reminders = [
      dailyMed({
        times: ["14:00"],
        schedule: {
          type: "daily-interval",
          intervalHours: 24,
          startTime: "14:00",
          times: ["14:00"],
          startDate: "2026-05-26", // starts day after tomorrow
        },
      }),
    ];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    // Today (24th) and tomorrow (25th) are before startDate → no slot.
    // But our horizon only looks today+tomorrow for daily-interval, so result is empty.
    expect(result.nextAt).toBeNull();
  });

  it("respects durationDays (treatment ended)", async () => {
    const reminders = [
      dailyMed({
        times: ["14:00"],
        schedule: {
          type: "daily-interval",
          intervalHours: 24,
          startTime: "14:00",
          times: ["14:00"],
          startDate: "2026-05-20",
          durationDays: 3, // ends 2026-05-22
        },
      }),
    ];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    expect(result.nextAt).toBeNull();
  });

  it("picks the earliest across multiple meds", async () => {
    const reminders = [
      dailyMed({ id: "m1", times: ["20:00"] }),
      dailyMed({ id: "m2", times: ["14:00"] }),
      dailyMed({ id: "m3", times: ["18:00"] }),
    ];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    expect(result.nextAt).toBe(epochMsForTzDateTime("2026-05-24", "14:00", TZ));
  });

  it("groups multiple slots within fire-fudge into due", async () => {
    const reminders = [
      dailyMed({ id: "m1", times: ["08:00"] }),
      dailyMed({ id: "m2", times: ["08:01"] }),
    ];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    expect(result.due).toHaveLength(2);
    expect(result.due.map((d) => "time" in d && d.time).sort()).toEqual(["08:00", "08:01"]);
  });

  it("enumerates one-shot pre-leads for unscheduled vaccine", async () => {
    const reminders: Reminder[] = [
      {
        id: "v1",
        kind: "vaccine",
        title: "Tríplice viral",
        profileId: "p1",
        createdAt: NOW - 86_400_000,
        status: "unscheduled",
        schedule: { type: "one-shot", date: "2026-06-30" },
      },
    ];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    // Default pre-leads: [30, 15, 7]. Next pre-lead from 2026-05-24:
    // 30 days before 06-30 = 05-31, 15 = 06-15, 7 = 06-23.
    // 05-31 09:00 is next.
    expect(result.nextAt).toBe(epochMsForTzDateTime("2026-05-31", "09:00", TZ));
  });

  it("uses post-leads for scheduled vaccine", async () => {
    const reminders: Reminder[] = [
      {
        id: "v1",
        kind: "vaccine",
        title: "Tríplice viral",
        profileId: "p1",
        createdAt: NOW - 86_400_000,
        status: "scheduled",
        schedule: { type: "one-shot", date: "2026-06-30" },
      },
    ];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    // Default post-leads for vaccine: [1] → fire 1 day before = 2026-06-29 09:00.
    expect(result.nextAt).toBe(epochMsForTzDateTime("2026-06-29", "09:00", TZ));
  });

  it("skips one-shot when status=done", async () => {
    const reminders: Reminder[] = [
      {
        id: "v1",
        kind: "vaccine",
        title: "Tríplice viral",
        profileId: "p1",
        createdAt: NOW - 86_400_000,
        status: "done",
        schedule: { type: "one-shot", date: "2026-06-30" },
      },
    ];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    expect(result.nextAt).toBeNull();
  });

  it("skips one-shot when event date is past", async () => {
    const reminders: Reminder[] = [
      {
        id: "v1",
        kind: "vaccine",
        title: "Tríplice viral",
        profileId: "p1",
        createdAt: NOW - 30 * 86_400_000,
        status: "unscheduled",
        schedule: { type: "one-shot", date: "2026-05-01" }, // way past
      },
    ];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    expect(result.nextAt).toBeNull();
  });

  it("mixes one-shot and daily-interval correctly", async () => {
    const reminders: Reminder[] = [
      dailyMed({ id: "m1", times: ["20:00"] }), // today 20:00 SP
      {
        id: "v1",
        kind: "vaccine",
        title: "Vacina",
        profileId: "p1",
        createdAt: NOW - 86_400_000,
        status: "unscheduled",
        schedule: { type: "one-shot", date: "2026-05-31" },
      },
    ];
    const result = await computeNextDose(TARGET, mkDeps({ reminders }), { now: NOW });
    // 2026-05-31 minus 7 days = 2026-05-24, but only lead 30/15/7. 7 days from 05-31 = 05-24 today.
    // Wait: pre-leads are [30, 15, 7]. addDays("2026-05-31", -7) = "2026-05-24" — today!
    // Fire time 09:00 SP today = 1h after NOW (08:00) → that's the nearest.
    expect(result.nextAt).toBe(epochMsForTzDateTime("2026-05-24", "09:00", TZ));
  });

  it("filters one-shot already notified", async () => {
    const reminders: Reminder[] = [
      {
        id: "v1",
        kind: "vaccine",
        title: "Vacina",
        profileId: "p1",
        createdAt: NOW - 86_400_000,
        status: "unscheduled",
        schedule: { type: "one-shot", date: "2026-05-31" },
      },
    ];
    const deps = mkDeps({
      reminders,
      notified: { "2026-05-24": ["v1#2026-05-31#d7"] },
    });
    const result = await computeNextDose(TARGET, deps, { now: NOW });
    // The 7-day pre-lead fires 2026-05-24 — already notified. Next is 15-day = nothing left (15 days before 05-31 = 05-16, past).
    // Actually wait: applicableLeads when unscheduled = preLeadDays = [30, 15, 7].
    // 30 days before 05-31 = 05-01 (past). 15 = 05-16 (past). 7 = 05-24 (today, notified).
    // So no more eligible.
    expect(result.nextAt).toBeNull();
  });

  it("invalid timezone in config falls through gracefully", async () => {
    // We default to "America/Sao_Paulo" if cfg.timezone is empty/missing.
    const reminders = [dailyMed({ times: ["14:00"] })];
    const deps = mkDeps({ config: { timezone: "" }, reminders });
    const result = await computeNextDose(TARGET, deps, { now: NOW });
    expect(result.nextAt).toBe(epochMsForTzDateTime("2026-05-24", "14:00", TZ));
  });
});
