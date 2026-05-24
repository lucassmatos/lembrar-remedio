import { NextResponse } from "next/server";
import { deleteUserCascade } from "@/lib/ddb";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  // deleteUserCascade removes shares, owned profiles (cascade), partner records,
  // config, chat mapping, and the users index entry.
  const result = await deleteUserCascade(s.sub);
  return NextResponse.json({ ok: true, ...result });
}
