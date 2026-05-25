import { NextResponse } from "next/server";
import { setConfig } from "@/lib/ddb";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Clears the caller's Telegram chatId (mirrors the /desvincular bot command).
// chatId isn't accepted by PATCH /api/config (webhook-only there), so the UI
// needs this dedicated path to actually unpair server-side.
export async function POST() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  await setConfig(s.sub, { chatId: undefined });
  return NextResponse.json({ ok: true });
}
