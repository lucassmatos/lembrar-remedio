export const PROFILE_COLORS = ["sage", "clay", "amber", "violet", "sky", "sand"] as const;
export type ProfileColor = (typeof PROFILE_COLORS)[number];

export type Profile = {
  id: string;
  name: string;
  color: ProfileColor;
  isDefault?: boolean;
  createdAt: number;
};

export const REMINDER_KINDS = ["medication", "vaccine", "appointment"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export type DailyIntervalSchedule = {
  type: "daily-interval";
  intervalHours: number;
  startTime: string;
  times?: string[];
  startDate?: string;
  durationDays?: number;
};

export type OneShotSchedule = {
  type: "one-shot";
  date: string;
  time?: string;
};

export type ReminderSchedule = DailyIntervalSchedule | OneShotSchedule;

export type ReminderStatus = "unscheduled" | "scheduled" | "done";

export const DEFAULT_PRE_LEADS: Record<ReminderKind, number[]> = {
  medication: [],
  vaccine: [30, 15, 7],
  appointment: [30, 15, 7],
};
export const DEFAULT_POST_LEADS: Record<ReminderKind, number[]> = {
  medication: [],
  vaccine: [1],
  appointment: [1],
};
export const ONE_SHOT_DEFAULT_TIME = "09:00";

export type Reminder = {
  id: string;
  kind: ReminderKind;
  title: string;
  subtitle?: string;
  schedule: ReminderSchedule;
  status?: ReminderStatus;
  preLeadDays?: number[];
  postLeadDays?: number[];
  profileId: string;
  seriesId?: string;
  createdAt: number;
};

export type Config = {
  chatId?: number;
  timezone: string;
  email?: string;
  name?: string;
  createdAt?: number;
};

export type DoseSlot = {
  reminderId: string;
  reminder: Reminder;
  time: string;
  minutes: number;
  taken: boolean;
  takenAt?: number;
};

export type DayLog = Record<string, { taken: boolean; takenAt: number }>;

export function isMedication(
  r: Reminder,
): r is Reminder & { schedule: DailyIntervalSchedule } {
  return r.kind === "medication" && r.schedule.type === "daily-interval";
}

export function isOneShot(
  r: Reminder,
): r is Reminder & { schedule: OneShotSchedule } {
  return r.schedule.type === "one-shot";
}
