import type { DayLog, DoseSlot, Medication } from "./types";

export function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function formatTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function slotKey(medId: string, time: string): string {
  return `${medId}@${time}`;
}

export function generateSlotsForMed(med: Medication): string[] {
  const start = parseTime(med.startTime);
  const interval = Math.max(1, Math.round(med.intervalHours * 60));
  const times: string[] = [];
  for (let t = start; t < start + 1440; t += interval) {
    times.push(formatTime(t));
    if (times.length > 48) break;
  }
  return Array.from(new Set(times)).sort();
}

export function todaySlots(meds: Medication[], log: DayLog): DoseSlot[] {
  const slots: DoseSlot[] = [];
  for (const med of meds) {
    for (const time of generateSlotsForMed(med)) {
      const key = slotKey(med.id, time);
      const entry = log[key];
      slots.push({
        medId: med.id,
        med,
        time,
        minutes: parseTime(time),
        taken: !!entry?.taken,
        takenAt: entry?.takenAt,
      });
    }
  }
  return slots.sort((a, b) => a.minutes - b.minutes);
}

export function nowInTz(tz: string): {
  date: string;
  minutes: number;
  iso: string;
} {
  const now = new Date();
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
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return { date, minutes, iso: now.toISOString() };
}
