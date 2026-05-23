import { NextRequest, NextResponse } from "next/server";
import { getConfig, getLog, setLogEntry } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { nowInTz } from "@/lib/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const url = new URL(req.url);
  const cfg = await getConfig(s.sub);
  const date = url.searchParams.get("date") ?? nowInTz(cfg.timezone).date;
  const log = await getLog(s.sub, date);
  return NextResponse.json({ date, log });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const body = (await req.json()) as { date?: string; slotKey: string; taken: boolean };
  if (!body.slotKey || typeof body.taken !== "boolean") {
    return NextResponse.json({ error: "slotKey e taken obrigatórios" }, { status: 400 });
  }
  const cfg = await getConfig(s.sub);
  const date = body.date ?? nowInTz(cfg.timezone).date;
  const log = await setLogEntry(s.sub, date, body.slotKey, body.taken);
  return NextResponse.json({ date, log });
}
