import type { Config, DayLog, Reminder } from "./types";
import {
  addDays,
  generateSlotsForReminder,
  medWindow,
  occurrenceKey,
  oneShotOccurrences,
  slotKey,
} from "./schedule";
import type { NotifyInput } from "./notify-one";
import {
  getConfig as ddbGetConfig,
  getLogForProfile,
  getNotifiedKeysForProfile,
  listRemindersForProfile,
} from "./ddb";

// Catch-up window: how far in the past a slot can be and still fire "now".
// Must comfortably exceed worst-case dispatch lag (EventBridge delivery delay,
// Lambda cold start, the 300s retry policy, a re-priming/migration burst).
// At 5min it sat right on that boundary: a fire ~6min late dropped the dose
// silently (not sent, not rescheduled). 60min recovers a late fire without
// firing stale doses — med slots are >=4h apart, so adjacent slots never
// collide in this window.
const DEFAULT_CATCH_UP_MS = 60 * 60_000;
const FIRE_FUDGE_MS = 60_000;

export type NextDoseTarget = { profileId: string; ownerSub: string };

export type NextDoseDeps = {
  getConfig: (sub: string) => Promise<Pick<Config, "timezone">>;
  listReminders: (profileId: string) => Promise<Reminder[]>;
  getLog: (profileId: string, date: string) => Promise<DayLog>;
  getNotifiedKeys: (profileId: string, date: string) => Promise<Set<string>>;
};

export type NextDoseOptions = {
  now?: number;
  catchUpMs?: number;
};

export type NextDoseResult = {
  due: NotifyInput[];
  nextAt: number | null;
};

type Occurrence = {
  input: NotifyInput;
  at: number;
  fireDate: string;
  key: string;
  kind: "med-slot" | "one-shot";
};

export async function computeNextDose(
  target: NextDoseTarget,
  deps: NextDoseDeps,
  opts: NextDoseOptions = {},
): Promise<NextDoseResult> {
  const now = opts.now ?? Date.now();
  const catchUpMs = opts.catchUpMs ?? DEFAULT_CATCH_UP_MS;

  // Timezone comes from the profile owner's config.
  // The chatId gate is intentionally removed: whether any member has a chatId
  // is decided at send time in notifyOneDose, not here.
  const cfg = await deps.getConfig(target.ownerSub);

  const reminders = await deps.listReminders(target.profileId);
  if (reminders.length === 0) return { due: [], nextAt: null };

  const tz = cfg.timezone || "America/Sao_Paulo";
  const todayDate = dateInTz(now, tz);

  const raw: Occurrence[] = [];

  for (const r of reminders) {
    if (r.schedule.type === "daily-interval") {
      const times = generateSlotsForReminder(r);
      if (times.length === 0) continue;
      const { startDate, endDate } = medWindow(r, tz);
      // Look at today + tomorrow only — daily-interval repeats every day.
      // Lambda re-runs each fire, so we don't need a longer horizon.
      for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
        const fireDate = addDays(todayDate, dayOffset);
        if (fireDate < startDate) continue;
        if (endDate && fireDate > endDate) continue;
        for (const time of times) {
          const at = epochMsForTzDateTime(fireDate, time, tz);
          if (at == null) continue;
          if (at < now - catchUpMs) continue;
          raw.push({
            input: { profileId: target.profileId, ownerSub: target.ownerSub, reminderId: r.id, time },
            at,
            fireDate,
            key: slotKey(r.id, time),
            kind: "med-slot",
          });
        }
      }
    } else {
      // one-shot — use the existing occurrence calculation
      for (const occ of oneShotOccurrences(r)) {
        const at = epochMsForTzDateTime(occ.date, occ.time, tz);
        if (at == null) continue;
        if (at < now - catchUpMs) continue;
        raw.push({
          input: {
            profileId: target.profileId,
            ownerSub: target.ownerSub,
            reminderId: r.id,
            targetDate: r.schedule.type === "one-shot" ? r.schedule.date : occ.date,
            lead: occ.lead,
          },
          at,
          fireDate: occ.date,
          key: occurrenceKey(r.id, r.schedule.type === "one-shot" ? r.schedule.date : occ.date, occ.lead),
          kind: "one-shot",
        });
      }
    }
  }

  if (raw.length === 0) return { due: [], nextAt: null };

  // Need log + notified set for each unique fire date — fetch in parallel.
  const fireDates = Array.from(new Set(raw.map((o) => o.fireDate)));
  const [logs, notifieds] = await Promise.all([
    Promise.all(fireDates.map((d) => deps.getLog(target.profileId, d).then((log) => [d, log] as const))),
    Promise.all(
      fireDates.map((d) => deps.getNotifiedKeys(target.profileId, d).then((set) => [d, set] as const)),
    ),
  ]);
  const logByDate = new Map(logs);
  const notifiedByDate = new Map(notifieds);

  const eligible = raw.filter((o) => {
    if (o.kind === "med-slot") {
      const log = logByDate.get(o.fireDate);
      if (log?.[o.key]?.taken) return false;
    }
    if (notifiedByDate.get(o.fireDate)?.has(o.key)) return false;
    return true;
  });

  if (eligible.length === 0) return { due: [], nextAt: null };

  // Items "due now" → fire this invocation.
  const due = eligible
    .filter((o) => o.at >= now - catchUpMs && o.at <= now + FIRE_FUDGE_MS)
    .sort((a, b) => a.at - b.at)
    .map((o) => o.input);

  // Next future occurrence (strictly after the fire-fudge window).
  const future = eligible
    .filter((o) => o.at > now + FIRE_FUDGE_MS)
    .sort((a, b) => a.at - b.at);
  const nextAt = future.length > 0 ? future[0].at : null;

  return { due, nextAt };
}

export function epochMsForTzDateTime(
  date: string,
  time: string,
  tz: string,
): number | null {
  const dm = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = time.match(/^(\d{2}):(\d{2})$/);
  if (!dm || !tm) return null;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  const h = Number(tm[1]);
  const mi = Number(tm[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;

  // Two-pass: guess UTC, measure offset at that guess, correct.
  // Handles all tz including DST except for non-existent times on spring-forward
  // (those land in the gap and we accept ~1h offset — rare for our use case).
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offset = tzOffsetMs(guess, tz);
  return guess - offset;
}

function tzOffsetMs(epochMs: number, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(epochMs))) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const tzAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return tzAsUtc - epochMs;
}

function dateInTz(epochMs: number, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(epochMs));
}

export const defaultDeps: NextDoseDeps = {
  getConfig: ddbGetConfig,
  listReminders: listRemindersForProfile,
  getLog: getLogForProfile,
  getNotifiedKeys: getNotifiedKeysForProfile,
};
