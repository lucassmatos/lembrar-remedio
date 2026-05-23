import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { putPairToken } from "@/lib/ddb";
import { botUsername } from "@/lib/telegram";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const token = nanoid(16);
  await putPairToken(token, s.sub, 600);
  const url = `https://t.me/${botUsername()}?start=${token}`;
  return NextResponse.redirect(url, 302);
}
