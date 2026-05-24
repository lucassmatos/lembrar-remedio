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
// Como o bebê foi alimentado: peito (lado), mamadeira (ml + conteúdo) ou
// extração da mãe (ml + lado). Registros legados não têm method = peito.
export const FEED_METHODS = ["breast", "bottle", "pump"] as const;
export type FeedMethod = (typeof FEED_METHODS)[number];
export const BOTTLE_CONTENTS = ["formula", "breastmilk"] as const;
export type BottleContent = (typeof BOTTLE_CONTENTS)[number];

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
  at: number; // epoch ms do registro
  method?: FeedMethod; // ausente em registros legados = "breast"
  side?: FeedSide; // peito e extração
  amountMl?: number; // mamadeira e extração
  content?: BottleContent; // mamadeira
};
export type Activity = NapActivity | FeedActivity;

export function isNap(a: Activity): a is NapActivity {
  return a.type === "nap";
}
export function isFeed(a: Activity): a is FeedActivity {
  return a.type === "feed";
}
/** Método da mamada, tratando registros legados (sem method) como peito. */
export function feedMethod(a: FeedActivity): FeedMethod {
  return a.method ?? "breast";
}
export function isOngoingNap(a: Activity): a is NapActivity {
  return isNap(a) && a.endedAt == null;
}
