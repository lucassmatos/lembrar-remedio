export const PROFILE_COLORS = ["sage", "clay", "amber", "violet", "sky", "sand"] as const;
export type ProfileColor = (typeof PROFILE_COLORS)[number];

export type ProfileShareRole = "partner" | "caregiver";

export type ProfileShareEntry = {
  sub: string;
  role: ProfileShareRole;
  addedAt: number;
};

export function isPartner(e: ProfileShareEntry): boolean {
  return e.role === "partner";
}

export function isCaregiver(e: ProfileShareEntry): boolean {
  return e.role === "caregiver";
}

export type PartnerRecord = {
  partnerSub: string;
  partnerEmail?: string;
  partnerName?: string;
  since: number;
};

export type ProfileShareLink = {
  ownerSub: string;
  profileId: string;
  role: ProfileShareRole;
  addedAt: number;
};

export type Profile = {
  id: string;
  name: string;
  color: ProfileColor;
  isDefault?: boolean;
  createdAt: number;
  ownerSub: string;
  sharedWith: ProfileShareEntry[];
  version: number;
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
  takenByName?: string;
};

export type DayLog = Record<string, {
  taken: boolean;
  takenAt: number;
  takenBy?: string;
  takenByName?: string;
}>;

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

// --- Activities (Diário): registros do que já aconteceu / está acontecendo ---
// Diferente de Reminder: não se agenda, não notifica. Soneca tem duração e um
// estado "em andamento" (sem endedAt). Mamada é pontual (lado + instante).
export const ACTIVITY_TYPES = ["nap", "feed"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const FEED_SIDES = ["left", "right"] as const;
export type FeedSide = (typeof FEED_SIDES)[number];

type BaseActivity = {
  id: string;
  type: ActivityType;
  profileId: string;
  date: string; // "YYYY-MM-DD" local (TZ do user) — bucket de query
  createdAt: number; // epoch ms
};
export type NapActivity = BaseActivity & {
  type: "nap";
  startedAt: number; // epoch ms
  endedAt?: number; // epoch ms; ausente = soneca em andamento
};
export type FeedActivity = BaseActivity & {
  type: "feed";
  side: FeedSide;
  at: number; // epoch ms do registro
};
export type Activity = NapActivity | FeedActivity;

export function isNap(a: Activity): a is NapActivity {
  return a.type === "nap";
}
export function isFeed(a: Activity): a is FeedActivity {
  return a.type === "feed";
}
export function isOngoingNap(a: Activity): a is NapActivity {
  return isNap(a) && a.endedAt == null;
}
