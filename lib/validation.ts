import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { FEED_SIDES, PROFILE_COLORS, REMINDER_KINDS } from "./types";

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
const ID = /^[A-Za-z0-9_-]{1,16}$/;

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
    timezone: TimezoneSchema,
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
  })
  .strict();
export type ProfilePost = z.infer<typeof ProfilePostSchema>;

export const ProfilePatchSchema = z
  .object({
    name: z.string().min(1).max(40).optional(),
    color: z.enum(PROFILE_COLORS).optional(),
  })
  .strict();
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

const EpochMs = z.number().int().positive();

export const ActivityPostSchema = z.discriminatedUnion("type", [
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
      side: z.enum(FEED_SIDES),
      at: EpochMs.optional(),
    })
    .strict(),
]);
export type ActivityPost = z.infer<typeof ActivityPostSchema>;

export const ActivityPatchSchema = z
  .object({
    date: z.string().regex(ISO_DATE, "YYYY-MM-DD"),
    startedAt: EpochMs.optional(),
    endedAt: EpochMs.nullable().optional(),
    side: z.enum(FEED_SIDES).optional(),
    at: EpochMs.optional(),
  })
  .strict();
export type ActivityPatch = z.infer<typeof ActivityPatchSchema>;

export const LogPostSchema = z
  .object({
    date: z.string().regex(ISO_DATE, "YYYY-MM-DD").optional(),
    slotKey: z.string().regex(SLOT_KEY, "expected reminderId@HH:MM"),
    taken: z.boolean(),
  })
  .strict();
export type LogPost = z.infer<typeof LogPostSchema>;
