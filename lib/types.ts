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
  /** Bebê que ainda mama: habilita a seção de mamada no diário. */
  aindaMama?: boolean;
  createdAt: number;
  ownerSub: string;
  sharedWith: ProfileShareEntry[];
  version: number;
};

// ── Recados da Casa: listas compartilhadas entre parceiros ──────────────────
export const LIST_KINDS = ["compras", "afazeres", "custom"] as const;
export type ListKind = (typeof LIST_KINDS)[number];

/** Uma lista da casa. Vive em user#<ownerSub>/list#<id>; visível ao owner e ao parceiro. */
export type HouseList = {
  id: string;
  ownerSub: string;
  title: string;
  kind: ListKind;
  createdAt: number;
  archivedAt?: number;
};

/** Item de lista. Vive em user#<ownerSub>/listitem#<listId>#<id>. */
export type ListItem = {
  id: string;
  listId: string;
  text: string;
  done: boolean;
  addedBy: string;
  doneBy?: string;
  createdAt: number;
};

// ── Rotinas da Casa: eventos recorrentes (calendário da casa) ───────────────
export const ROUTINE_FREQS = ["daily", "weekly", "monthly"] as const;
export type RoutineFreq = (typeof ROUTINE_FREQS)[number];

/**
 * Evento recorrente da casa (ex.: "Pagar escola dia 25"). Compartilhado entre
 * parceiros via getPartner, mesmo padrão das listas. Vive em
 * user#<ownerSub>/routine#<id>.
 *
 * anchor depende de freq:
 *  - monthly: 1-31 (dia do mês)
 *  - weekly:  0-6 (dom=0 ... sáb=6)
 *  - daily:   undefined (toda execução)
 *
 * time é opcional HH:MM. Sem ele, a Timeline mostra de manhã (08:00) pra
 * lembrar logo cedo no dia.
 */
export type HouseRoutine = {
  id: string;
  ownerSub: string;
  title: string;
  freq: RoutineFreq;
  anchor?: number;
  time?: string;
  createdAt: number;
  archivedAt?: number;
};

/**
 * Marcação "feita neste período". period é YYYY-MM-DD (daily), YYYY-Www
 * (weekly ISO) ou YYYY-MM (monthly). Sk: routinedone#<routineId>#<period>.
 */
export type RoutineDone = {
  routineId: string;
  period: string;
  doneBy: string;
  doneAt: number;
};

/**
 * Aniversário da casa. Dado compartilhado entre parceiros (mesmo padrão das
 * rotinas/listas, descoberta via getPartner). Não tem perfilId — é da casa,
 * não da pessoa cuidada. Só nome + dia/mês: idade não interessa, reminder.
 * Sk: birthday#<id>.
 */
export type Birthday = {
  id: string;
  ownerSub: string;
  name: string;
  month: number; // 1-12
  day: number;   // 1-31
  createdAt: number;
};

/**
 * Evento solto da casa (uma data só, não recorrente): "Festa do João dia 12",
 * "Reunião na escola dia 20". Compartilhado entre parceiros (mesmo padrão de
 * rotinas/aniversários, descoberta via getPartner). Sem perfil e sem check:
 * aparece na Timeline até o dia e some depois (igual aniversário). Vive em
 * user#<ownerSub>/event#<id>.
 */
export type HouseEvent = {
  id: string;
  ownerSub: string;
  title: string;
  date: string; // "YYYY-MM-DD" no tz do dono
  time?: string; // HH:MM opcional; sem ele a Timeline mostra só a data
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
  /** Tela inicial preferida ao abrir o app. Default: timeline. */
  startScreen?: "timeline" | "diario";
  /**
   * De quais perfis este usuário quer receber notificação de dose. É uma
   * preferência do destinatário (não do dono do perfil): cada membro decide,
   * por perfil, se quer ser avisado. `undefined` = nunca configurado → cai no
   * default "só a própria pessoa" (recebe apenas dos perfis que ele mesmo é
   * dono). Lista vazia = silencia tudo. Ver `lib/notify-prefs.ts`.
   */
  notifyProfileIds?: string[];
  /** Token opaco do mostrador físico (e-paper). Autentica /api/device/*. */
  deviceToken?: string;
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
