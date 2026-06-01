import { NextRequest, NextResponse } from "next/server";
import { deleteHouseRoutineCascade, getHouseRoutine, putHouseRoutine } from "@/lib/ddb";
import { mapAccessError, requireHouseholdAccess } from "@/lib/sharing";
import { requireSession } from "@/lib/session";
import type { HouseRoutine } from "@/lib/types";
import { parseBody, RoutinePatchSchema, SUB } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH — edita uma rotina. Replace dos campos editáveis (title/freq/anchor/time);
// id/ownerSub/createdAt preservados. Trocar de freq pode zerar o anchor (daily).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  const ownerSub = new URL(req.url).searchParams.get("ownerSub");
  if (!ownerSub || !SUB.test(ownerSub)) {
    return NextResponse.json({ error: "ownerSub obrigatório" }, { status: 400 });
  }
  const parsed = await parseBody(req, RoutinePatchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    await requireHouseholdAccess(s.sub, ownerSub);
  } catch (e) {
    return mapAccessError(e);
  }
  const existing = await getHouseRoutine(ownerSub, id);
  if (!existing) return NextResponse.json({ error: "routine not found" }, { status: 404 });
  const body = parsed.data;
  const routine: HouseRoutine = {
    id: existing.id,
    ownerSub: existing.ownerSub,
    createdAt: existing.createdAt,
    title: body.title.trim(),
    freq: body.freq,
    ...(body.anchor != null ? { anchor: body.anchor } : {}),
    ...(body.time ? { time: body.time } : {}),
  };
  await putHouseRoutine(ownerSub, routine);
  return NextResponse.json({ routine });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  const ownerSub = new URL(req.url).searchParams.get("ownerSub");
  if (!ownerSub || !SUB.test(ownerSub)) {
    return NextResponse.json({ error: "ownerSub obrigatório" }, { status: 400 });
  }
  try {
    await requireHouseholdAccess(s.sub, ownerSub);
  } catch (e) {
    return mapAccessError(e);
  }
  await deleteHouseRoutineCascade(ownerSub, id);
  return NextResponse.json({ ok: true });
}
