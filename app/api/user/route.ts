import { NextResponse } from "next/server";
import { deleteUserCascade } from "@/lib/ddb";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const result = await deleteUserCascade(s.sub);
  // The EventBridge schedule (lr-user-{sub}) is removed by the DDB stream
  // handler when it sees the config item disappear — keeps Vercel out of the
  // scheduler IAM picture.
  return NextResponse.json({ ok: true, ...result });
}
