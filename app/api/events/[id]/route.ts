import { NextRequest, NextResponse } from "next/server";
import { deleteHouseEvent, getHouseEvent, putHouseEvent } from "@/lib/ddb";
import { mapAccessError, requireHouseholdAccess } from "@/lib/sharing";
import { requireSession } from "@/lib/session";
import type { HouseEvent } from "@/lib/types";
import { EventPatchSchema, parseBody, SUB } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownerFrom(req: NextRequest): string | null {
  const o = new URL(req.url).searchParams.get("ownerSub");
  return o && SUB.test(o) ? o : null;
}

// PATCH — edita um evento (replace de title/date/time). id/ownerSub/createdAt preservados.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  const ownerSub = ownerFrom(req);
  if (!ownerSub) return NextResponse.json({ error: "ownerSub obrigatório" }, { status: 400 });
  const parsed = await parseBody(req, EventPatchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    await requireHouseholdAccess(s.sub, ownerSub);
  } catch (e) {
    return mapAccessError(e);
  }
  const existing = await getHouseEvent(ownerSub, id);
  if (!existing) return NextResponse.json({ error: "event not found" }, { status: 404 });
  const body = parsed.data;
  const event: HouseEvent = {
    id: existing.id,
    ownerSub: existing.ownerSub,
    createdAt: existing.createdAt,
    title: body.title.trim(),
    date: body.date,
    ...(body.time ? { time: body.time } : {}),
  };
  await putHouseEvent(ownerSub, event);
  return NextResponse.json({ event });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  const ownerSub = ownerFrom(req);
  if (!ownerSub) return NextResponse.json({ error: "ownerSub obrigatório" }, { status: 400 });
  try {
    await requireHouseholdAccess(s.sub, ownerSub);
  } catch (e) {
    return mapAccessError(e);
  }
  await deleteHouseEvent(ownerSub, id);
  return NextResponse.json({ ok: true });
}
