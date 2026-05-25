import { NextRequest, NextResponse } from "next/server";
import { putPushSub, deletePushSub, pushSubId } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { PushSubscribeSchema, PushUnsubscribeSchema, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, PushSubscribeSchema);
  if (!parsed.ok) return parsed.response;
  await putPushSub(s.sub, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, PushUnsubscribeSchema);
  if (!parsed.ok) return parsed.response;
  await deletePushSub(s.sub, pushSubId(parsed.data.endpoint));
  return NextResponse.json({ ok: true });
}
