import { NextRequest, NextResponse } from "next/server";
import { deleteActivity, getActivity, getConfig, putActivity } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { dateInTz } from "@/lib/schedule";
import type { Activity } from "@/lib/types";
import { ActivityPatchSchema, ISO_DATE, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  const date = new URL(req.url).searchParams.get("date");
  if (!date || !ISO_DATE.test(date)) {
    return NextResponse.json({ error: "date é obrigatório (YYYY-MM-DD)" }, { status: 400 });
  }
  const existing = await getActivity(s.sub, date, id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await deleteActivity(s.sub, date, id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  const parsed = await parseBody(req, ActivityPatchSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const existing = await getActivity(s.sub, body.date, id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const tz = (await getConfig(s.sub)).timezone;
  const updated: Activity = { ...existing };

  if (updated.type === "nap") {
    if (body.startedAt !== undefined) updated.startedAt = body.startedAt;
    if (body.endedAt !== undefined) updated.endedAt = body.endedAt ?? undefined;
    updated.date = dateInTz(updated.startedAt, tz).date;
  } else {
    if (body.at !== undefined) updated.at = body.at;
    if (body.side !== undefined) updated.side = body.side;
    if (body.amountMl !== undefined) updated.amountMl = body.amountMl;
    if (body.content !== undefined) updated.content = body.content;
    updated.date = dateInTz(updated.at, tz).date;
  }

  // Se o dia mudou, o item muda de bucket (sk): remove o antigo e grava o novo.
  if (updated.date !== existing.date) {
    await deleteActivity(s.sub, existing.date, id);
  }
  await putActivity(s.sub, updated);
  return NextResponse.json({ activity: updated });
}
