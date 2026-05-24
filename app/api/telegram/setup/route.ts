import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { setWebhook } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest) {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    console.error("APP_SECRET not configured");
    return new NextResponse("misconfigured", { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!constantTimeEqual(auth, expected)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const body = (await req.json()) as { url?: string };
  const url = body.url;
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url obrigatório" }, { status: 400 });
  }
  const tgSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!tgSecret) {
    return NextResponse.json(
      { error: "TELEGRAM_WEBHOOK_SECRET não configurado" },
      { status: 500 },
    );
  }
  const result = await setWebhook(url, tgSecret);
  return NextResponse.json(result);
}
