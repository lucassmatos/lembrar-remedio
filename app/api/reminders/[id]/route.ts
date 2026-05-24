import { NextRequest, NextResponse } from "next/server";
import { deleteReminder, getReminder, putReminder } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import type { Reminder } from "@/lib/types";
import { ReminderPatchSchema, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  const existing = await getReminder(s.sub, id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await deleteReminder(s.sub, id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  const existing = await getReminder(s.sub, id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const parsed = await parseBody(req, ReminderPatchSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

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
        { error: "schedule de remédio precisa ser daily-interval" },
        { status: 400 },
      );
    }
    if (existing.kind !== "medication" && body.schedule.type !== "one-shot") {
      return NextResponse.json(
        { error: "schedule de vacina/retorno precisa ser one-shot" },
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
  await putReminder(s.sub, updated);
  return NextResponse.json({ reminder: updated });
}

function sortLeads(leads?: number[]): number[] | undefined {
  if (!leads || leads.length === 0) return undefined;
  return Array.from(new Set(leads)).sort((a, b) => b - a);
}
