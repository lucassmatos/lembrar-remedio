import { NextRequest, NextResponse } from "next/server";
import { deleteMed, listMeds, putMed } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import type { Medication } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  await deleteMed(s.sub, id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  const body = (await req.json()) as Partial<Medication>;
  const meds = await listMeds(s.sub);
  const existing = meds.find((m) => m.id === id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (
    body.startDate !== undefined &&
    body.startDate !== null &&
    !(typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate))
  ) {
    return NextResponse.json({ error: "startDate inválido" }, { status: 400 });
  }
  if (
    body.durationDays !== undefined &&
    body.durationDays !== null &&
    !(typeof body.durationDays === "number" && body.durationDays > 0)
  ) {
    return NextResponse.json({ error: "durationDays inválido" }, { status: 400 });
  }
  const updated: Medication = {
    ...existing,
    ...body,
    id: existing.id,
    createdAt: existing.createdAt,
    durationDays:
      body.durationDays === null ? undefined : body.durationDays ?? existing.durationDays,
    startDate:
      body.startDate === null ? undefined : body.startDate ?? existing.startDate,
  };
  await putMed(s.sub, updated);
  return NextResponse.json({ med: updated });
}
