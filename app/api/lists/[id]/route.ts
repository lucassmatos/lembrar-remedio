import { NextRequest, NextResponse } from "next/server";
import { deleteHouseListCascade, getHouseList, listItems } from "@/lib/ddb";
import { mapAccessError, requireHouseholdAccess } from "@/lib/sharing";
import { requireSession } from "@/lib/session";
import { SUB } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownerFrom(req: NextRequest): string | null {
  const owner = new URL(req.url).searchParams.get("ownerSub");
  return owner && SUB.test(owner) ? owner : null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const list = await getHouseList(ownerSub, id);
  if (!list) return NextResponse.json({ error: "not found" }, { status: 404 });
  const items = await listItems(ownerSub, id);
  return NextResponse.json({ list, items });
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

  await deleteHouseListCascade(ownerSub, id);
  return NextResponse.json({ ok: true });
}
