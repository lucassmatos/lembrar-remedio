import { NextRequest, NextResponse } from "next/server";
import { setWebhook } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.APP_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const body = (await req.json()) as { url?: string };
  const url = body.url;
  if (!url) return NextResponse.json({ error: "url obrigatório" }, { status: 400 });
  const tgSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const result = await setWebhook(url, tgSecret);
  return NextResponse.json(result);
}
