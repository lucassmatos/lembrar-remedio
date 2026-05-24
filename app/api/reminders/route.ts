import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  ensureDefaultProfile,
  listProfilesForUser,
  listRemindersForProfile,
  putReminderForProfile,
} from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { requireProfileAccess } from "@/lib/sharing";
import type { Reminder } from "@/lib/types";
import { ReminderPostSchema, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const grants = await listProfilesForUser(s.sub);
  const remindersNested = await Promise.all(
    grants.map((g) => listRemindersForProfile(g.profile.id)),
  );
  const reminders = remindersNested.flat();
  return NextResponse.json({ reminders });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, ReminderPostSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const profileId = await resolveProfileId(s.sub, body.profileId);

  try {
    await requireProfileAccess(s.sub, profileId, "editor");
  } catch (e) {
    const { mapAccessError } = await import("@/lib/sharing");
    return mapAccessError(e);
  }

  const isMed = body.kind === "medication";

  const reminder: Reminder = {
    id: nanoid(8),
    kind: body.kind,
    title: body.title.trim(),
    subtitle: body.subtitle?.trim() || undefined,
    schedule: body.schedule,
    status: isMed ? undefined : "unscheduled",
    preLeadDays: isMed ? undefined : sortLeads(body.preLeadDays),
    postLeadDays: isMed ? undefined : sortLeads(body.postLeadDays),
    profileId,
    seriesId: body.seriesId,
    createdAt: Date.now(),
  };
  await putReminderForProfile(reminder);
  return NextResponse.json({ reminder });
}

function sortLeads(leads?: number[]): number[] | undefined {
  if (!leads || leads.length === 0) return undefined;
  return Array.from(new Set(leads)).sort((a, b) => b - a);
}

async function resolveProfileId(sub: string, requested?: string): Promise<string> {
  if (requested) {
    const grants = await listProfilesForUser(sub);
    const match = grants.find((g) => g.profile.id === requested);
    if (match) return match.profile.id;
  }
  const def = await ensureDefaultProfile(sub);
  return def.id;
}
