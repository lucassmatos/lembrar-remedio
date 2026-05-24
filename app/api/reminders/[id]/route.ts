import { NextRequest, NextResponse } from "next/server";
import {
  deleteReminderForProfile,
  putReminderForProfile,
} from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import {
  requireProfileAccess,
  findReminder,
  mapAccessError,
} from "@/lib/sharing";
import type { Reminder } from "@/lib/types";
import { ReminderPatchSchema, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;

  const found = await findReminder(s.sub, id);
  if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    await requireProfileAccess(s.sub, found.profileId, "editor");
  } catch (e) {
    return mapAccessError(e);
  }

  await deleteReminderForProfile(found.profileId, id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;

  const found = await findReminder(s.sub, id);
  if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    await requireProfileAccess(s.sub, found.profileId, "editor");
  } catch (e) {
    return mapAccessError(e);
  }

  const parsed = await parseBody(req, ReminderPatchSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const existing = found.reminder;

  // If profileId is being changed, check access on the new profile too.
  if (body.profileId !== undefined && body.profileId !== found.profileId) {
    try {
      await requireProfileAccess(s.sub, body.profileId, "editor");
    } catch (e) {
      return mapAccessError(e);
    }
  }

  const updated: Reminder = { ...existing };
  if (body.title !== undefined) updated.title = body.title.trim();
  if (body.subtitle !== undefined) {
    updated.subtitle = body.subtitle ? body.subtitle.trim() || undefined : undefined;
  }
  if (body.profileId !== undefined) updated.profileId = body.profileId;
  if (body.seriesId !== undefined) {
    updated.seriesId = body.seriesId ?? undefined;
  }
  if (body.schedule !== undefined) {
    // Schedule type must match existing kind (kind itself isn't editable here).
    if (existing.kind === "medication" && body.schedule.type !== "daily-interval") {
      return NextResponse.json(
        { error: "schedule de medicamento precisa ser daily-interval" },
        { status: 400 },
      );
    }
    if (existing.kind !== "medication" && body.schedule.type !== "one-shot") {
      return NextResponse.json(
        { error: "schedule de vacina/consulta precisa ser one-shot" },
        { status: 400 },
      );
    }
    updated.schedule = body.schedule;
  }
  if (existing.kind !== "medication") {
    if (body.preLeadDays !== undefined) updated.preLeadDays = sortLeads(body.preLeadDays);
    if (body.postLeadDays !== undefined) updated.postLeadDays = sortLeads(body.postLeadDays);
    if (body.status !== undefined) updated.status = body.status;
  }

  // If profileId changed, delete from old profile and write to new.
  if (updated.profileId !== found.profileId) {
    await deleteReminderForProfile(found.profileId, id);
  }
  await putReminderForProfile(updated);
  return NextResponse.json({ reminder: updated });
}

function sortLeads(leads?: number[]): number[] | undefined {
  if (!leads || leads.length === 0) return undefined;
  return Array.from(new Set(leads)).sort((a, b) => b - a);
}
