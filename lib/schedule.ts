import {
  DEFAULT_POST_LEADS,
  DEFAULT_PRE_LEADS,
  ONE_SHOT_DEFAULT_TIME,
  type DayLog,
  type DoseSlot,
  type Reminder,
  type ReminderStatus,
} from "./types";

export function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function formatTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function slotKey(reminderId: string, time: string): string {
  return `${reminderId}@${time}`;
}

export function occurrenceKey(reminderId: string, date: string, lead: number): string {
  return `${reminderId}#${date}#d${lead}`;
}

export function generateSlotsForReminder(reminder: Reminder): string[] {
  if (reminder.schedule.type !== "daily-interval") return [];
  const sch = reminder.schedule;
  if (sch.times && sch.times.length > 0) {
    const valid = sch.times.filter((t) => /^\d{2}:\d{2}$/.test(t));
    return Array.from(new Set(valid)).sort();
  }
  const start = parseTime(sch.startTime);
  const interval = Math.max(1, Math.round(sch.intervalHours * 60));
  const times: string[] = [];
  for (let t = start; t < start + 1440; t += interval) {
    times.push(formatTime(t));
    if (times.length > 48) break;
  }
  return Array.from(new Set(times)).sort();
}

export function medWindow(
  reminder: Reminder,
  tz: string,
): { startDate: string; endDate: string | null } {
  if (reminder.schedule.type !== "daily-interval") {
    return { startDate: dateInTz(reminder.createdAt, tz).date, endDate: null };
  }
  const sch = reminder.schedule;
  const startDate = sch.startDate ?? dateInTz(reminder.createdAt, tz).date;
  const endDate =
    sch.durationDays && sch.durationDays > 0
      ? addDays(startDate, sch.durationDays - 1)
      : null;
  return { startDate, endDate };
}

export function todaySlots(
  reminders: Reminder[],
  log: DayLog,
  today?: { date: string; tz: string },
): DoseSlot[] {
  const slots: DoseSlot[] = [];
  for (const reminder of reminders) {
    if (reminder.schedule.type !== "daily-interval") continue;
    let minMinutes: number | null = null;
    if (today) {
      const created = dateInTz(reminder.createdAt, today.tz);
      const { startDate, endDate } = medWindow(reminder, today.tz);
      if (today.date < startDate) continue;
      if (endDate && today.date > endDate) continue;
      if (created.date === today.date && startDate === today.date) {
        minMinutes = created.minutes;
      }
    }
    for (const time of generateSlotsForReminder(reminder)) {
      const minutes = parseTime(time);
      if (minMinutes !== null && minutes < minMinutes) continue;
      const key = slotKey(reminder.id, time);
      const entry = log[key];
      slots.push({
        reminderId: reminder.id,
        reminder,
        time,
        minutes,
        taken: !!entry?.taken,
        takenAt: entry?.takenAt,
      });
    }
  }
  return slots.sort((a, b) => a.minutes - b.minutes);
}

export type OneShotOccurrence = {
  reminderId: string;
  date: string;
  time: string;
  lead: number;
  occurrenceKey: string;
};

export function effectiveStatus(reminder: Reminder): ReminderStatus {
  if (reminder.schedule.type !== "one-shot") return "scheduled";
  return reminder.status ?? "unscheduled";
}

export function applicableLeads(reminder: Reminder): number[] {
  if (reminder.schedule.type !== "one-shot") return [];
  const status = effectiveStatus(reminder);
  if (status === "done") return [];
  const pre =
    reminder.preLeadDays ?? DEFAULT_PRE_LEADS[reminder.kind] ?? [];
  const post =
    reminder.postLeadDays ?? DEFAULT_POST_LEADS[reminder.kind] ?? [];
  return status === "unscheduled" ? pre : post;
}

export function oneShotOccurrences(reminder: Reminder): OneShotOccurrence[] {
  if (reminder.schedule.type !== "one-shot") return [];
  const sch = reminder.schedule;
  const time = sch.time && /^\d{2}:\d{2}$/.test(sch.time) ? sch.time : ONE_SHOT_DEFAULT_TIME;
  const out: OneShotOccurrence[] = [];
  for (const lead of applicableLeads(reminder)) {
    const date = addDays(sch.date, -lead);
    out.push({
      reminderId: reminder.id,
      date,
      time,
      lead,
      occurrenceKey: occurrenceKey(reminder.id, sch.date, lead),
    });
  }
  return out;
}

export function isOneShotPast(reminder: Reminder, todayDate: string): boolean {
  if (reminder.schedule.type !== "one-shot") return false;
  return reminder.schedule.date < todayDate;
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const x = new Date(utc);
  const yy = x.getUTCFullYear();
  const mm = String(x.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(x.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000,
  );
}

export function formatBrDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function dateInTz(timestamp: number, tz: string): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(timestamp)).map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return { date, minutes };
}

export function nowInTz(tz: string): {
  date: string;
  minutes: number;
  iso: string;
} {
  const { date, minutes } = dateInTz(Date.now(), tz);
  return { date, minutes, iso: new Date().toISOString() };
}
