import { NextRequest, NextResponse } from "next/server";
import { deleteBirthday } from "@/lib/ddb";
import { mapAccessError, requireHouseholdAccess } from "@/lib/sharing";
import { requireSession } from "@/lib/session";
import { SUB } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  await deleteBirthday(ownerSub, id);
  return NextResponse.json({ ok: true });
}
