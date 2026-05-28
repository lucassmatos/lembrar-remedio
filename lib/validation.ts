import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { BOTTLE_CONTENTS, FEED_METHODS, FEED_SIDES, LIST_KINDS, PROFILE_COLORS, REMINDER_KINDS, ROUTINE_FREQS } from "./types";

const MAX_BODY_BYTES = 64 * 1024;

export async function parseBody<T>(
  req: NextRequest,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json({ error: "payload too large" }, { status: 413 }),
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "invalid JSON" }, { status: 400 }),
    };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "invalid input", issues: result.error.issues },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: result.data };
}

const HHMM = /^\d{2}:\d{2}$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLOT_KEY = /^[A-Za-z0-9_-]{1,32}@\d{2}:\d{2}$/;
export const ID = /^[A-Za-z0-9_-]{1,16}$/;

let TZ_SET: Set<string> | null = null;
function isValidTz(tz: string): boolean {
  if (!TZ_SET) {
    try {
      const supported = (Intl as unknown as {
        supportedValuesOf?: (k: string) => string[];
      }).supportedValuesOf?.("timeZone");
      TZ_SET = new Set(supported ?? []);
    } catch {
      TZ_SET = new Set();
    }
  }
  if (TZ_SET.size > 0) return TZ_SET.has(tz);
  // Fallback: try to construct a DateTimeFormat
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const TimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTz, "invalid timezone");

export const ConfigPatchSchema = z
  .object({
    timezone: TimezoneSchema.optional(),
    startScreen: z.enum(["timeline", "diario"]).optional(),
  })
  .strict();
export type ConfigPatch = z.infer<typeof ConfigPatchSchema>;

const DailyIntervalScheduleSchema = z.object({
  type: z.literal("daily-interval"),
  intervalHours: z.number().min(0.5).max(48),
  startTime: z.string().regex(HHMM, "HH:MM"),
  times: z.array(z.string().regex(HHMM, "HH:MM")).max(24).optional(),
  startDate: z.string().regex(ISO_DATE, "YYYY-MM-DD").optional(),
  durationDays: z.number().int().min(1).max(365).optional(),
});
const OneShotScheduleSchema = z.object({
  type: z.literal("one-shot"),
  date: z.string().regex(ISO_DATE, "YYYY-MM-DD"),
  time: z.string().regex(HHMM, "HH:MM").optional(),
});
const ScheduleSchema = z.discriminatedUnion("type", [
  DailyIntervalScheduleSchema,
  OneShotScheduleSchema,
]);

const LeadsSchema = z.array(z.number().int().min(0).max(365)).max(10);

export const ReminderPostSchema = z
  .object({
    kind: z.enum(REMINDER_KINDS),
    title: z.string().min(1).max(120),
    subtitle: z.string().max(200).optional(),
    schedule: ScheduleSchema,
    profileId: z.string().regex(ID).optional(),
    seriesId: z.string().regex(ID).optional(),
    preLeadDays: LeadsSchema.optional(),
    postLeadDays: LeadsSchema.optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.kind === "medication"
        ? d.schedule.type === "daily-interval"
        : d.schedule.type === "one-shot",
    { message: "schedule.type não combina com kind", path: ["schedule", "type"] },
  );
export type ReminderPost = z.infer<typeof ReminderPostSchema>;

export const ReminderPatchSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    subtitle: z.string().max(200).nullable().optional(),
    schedule: ScheduleSchema.optional(),
    profileId: z.string().regex(ID).optional(),
    seriesId: z.string().regex(ID).nullable().optional(),
    preLeadDays: LeadsSchema.optional(),
    postLeadDays: LeadsSchema.optional(),
    status: z.enum(["unscheduled", "scheduled", "done"]).optional(),
  })
  .strict();
export type ReminderPatch = z.infer<typeof ReminderPatchSchema>;

export const ProfilePostSchema = z
  .object({
    name: z.string().min(1).max(40),
    color: z.enum(PROFILE_COLORS).optional(),
    aindaMama: z.boolean().optional(),
  })
  .strict();
export type ProfilePost = z.infer<typeof ProfilePostSchema>;

export const ProfilePatchSchema = z
  .object({
    name: z.string().min(1).max(40).optional(),
    color: z.enum(PROFILE_COLORS).optional(),
    aindaMama: z.boolean().optional(),
  })
  .strict();
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

const EpochMs = z.number().int().positive();
const AmountMl = z.number().int().min(1).max(2000);

export const ActivityPostSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("nap"),
        profileId: z.string().regex(ID).optional(),
        startedAt: EpochMs.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("feed"),
        profileId: z.string().regex(ID).optional(),
        method: z.enum(FEED_METHODS),
        side: z.enum(FEED_SIDES).optional(),
        amountMl: AmountMl.optional(),
        content: z.enum(BOTTLE_CONTENTS).optional(),
        at: EpochMs.optional(),
      })
      .strict(),
  ])
  .superRefine((d, ctx) => {
    if (d.type !== "feed") return;
    const need = (field: "side" | "amountMl" | "content", ok: boolean) => {
      if (!ok) {
        ctx.addIssue({
          code: "custom",
          message: `${field} obrigatório para método ${d.method}`,
          path: [field],
        });
      }
    };
    if (d.method === "breast") need("side", d.side != null);
    if (d.method === "bottle") {
      need("amountMl", d.amountMl != null);
      need("content", d.content != null);
    }
    if (d.method === "pump") {
      need("amountMl", d.amountMl != null);
      need("side", d.side != null);
    }
  });
export type ActivityPost = z.infer<typeof ActivityPostSchema>;

export const ActivityPatchSchema = z
  .object({
    date: z.string().regex(ISO_DATE, "YYYY-MM-DD"),
    startedAt: EpochMs.optional(),
    endedAt: EpochMs.nullable().optional(),
    side: z.enum(FEED_SIDES).optional(),
    amountMl: AmountMl.optional(),
    content: z.enum(BOTTLE_CONTENTS).optional(),
    at: EpochMs.optional(),
  })
  .strict();
export type ActivityPatch = z.infer<typeof ActivityPatchSchema>;

// ── Recados da Casa ──────────────────────────────────────────────────────────
// ownerSub é um sub do NextAuth (Google sub numérico, ou "dev-user" em dev).
export const SUB = /^[A-Za-z0-9_-]{1,255}$/;

export const ListPostSchema = z
  .object({
    title: z.string().min(1).max(80),
    kind: z.enum(LIST_KINDS).optional(),
  })
  .strict();
export type ListPost = z.infer<typeof ListPostSchema>;

export const ItemPostSchema = z
  .object({
    text: z.string().min(1).max(200),
  })
  .strict();
export type ItemPost = z.infer<typeof ItemPostSchema>;

export const ItemPatchSchema = z
  .object({
    itemId: z.string().regex(ID),
    done: z.boolean(),
  })
  .strict();
export type ItemPatch = z.infer<typeof ItemPatchSchema>;

// ── Rotinas (calendário da casa) ─────────────────────────────────────────────
// anchor depende de freq: monthly 1-31, weekly 0-6 (dom=0), daily ausente.
// Validação cruzada via refine.
export const RoutinePostSchema = z
  .object({
    title: z.string().min(1).max(80),
    freq: z.enum(ROUTINE_FREQS),
    anchor: z.number().int().min(0).max(31).optional(),
    time: z.string().regex(HHMM, "HH:MM").optional(),
  })
  .strict()
  .refine(
    (d) => {
      if (d.freq === "daily") return d.anchor == null;
      if (d.freq === "weekly") return d.anchor != null && d.anchor >= 0 && d.anchor <= 6;
      if (d.freq === "monthly") return d.anchor != null && d.anchor >= 1 && d.anchor <= 31;
      return false;
    },
    { message: "anchor não combina com freq", path: ["anchor"] },
  );
export type RoutinePost = z.infer<typeof RoutinePostSchema>;

export const PERIOD = /^[0-9A-Za-z-]{4,20}$/;
export const RoutineDonePostSchema = z
  .object({ period: z.string().regex(PERIOD) })
  .strict();
export type RoutineDonePost = z.infer<typeof RoutineDonePostSchema>;

// ── Aniversários da casa ─────────────────────────────────────────────────────
const CURRENT_YEAR = new Date().getUTCFullYear();
export const BirthdayPostSchema = z
  .object({
    name: z.string().min(1).max(80),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    year: z.number().int().min(1900).max(CURRENT_YEAR + 1).optional(),
  })
  .strict()
  .refine(
    (d) => {
      // Valida data realista (Feb 30 → false). Usa ano-bissexto pra permitir 29/2.
      const lastDay = new Date(Date.UTC(2000, d.month, 0)).getUTCDate();
      return d.day <= lastDay;
    },
    { message: "data inválida", path: ["day"] },
  );
export type BirthdayPost = z.infer<typeof BirthdayPostSchema>;

export const PushSubscribeSchema = z
  .object({
    endpoint: z.string().url().max(1000),
    keys: z
      .object({
        p256dh: z.string().min(1).max(200),
        auth: z.string().min(1).max(200),
      })
      .strict(),
  })
  .strict();
export type PushSubscribe = z.infer<typeof PushSubscribeSchema>;

export const PushUnsubscribeSchema = z
  .object({ endpoint: z.string().url().max(1000) })
  .strict();

export const LogPostSchema = z
  .object({
    date: z.string().regex(ISO_DATE, "YYYY-MM-DD").optional(),
    slotKey: z.string().regex(SLOT_KEY, "expected reminderId@HH:MM"),
    taken: z.boolean(),
  })
  .strict();
export type LogPost = z.infer<typeof LogPostSchema>;
