import { NextRequest, NextResponse } from "next/server";
import { getConfig, getLog, listReminders, setLogEntry } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { nowInTz } from "@/lib/schedule";
import { LogPostSchema, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const cfg = await getConfig(s.sub);
  const effectiveDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : nowInTz(cfg.timezone).date;
  const log = await getLog(s.sub, effectiveDate);
  return NextResponse.json({ date: effectiveDate, log });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, LogPostSchema);
  if (!parsed.ok) return parsed.response;
  const { date, slotKey, taken } = parsed.data;

  // slotKey is `${reminderId}@HH:MM` — ensure the reminderId belongs to this user.
  const [reminderId] = slotKey.split("@");
  const reminders = await listReminders(s.sub);
  if (!reminders.some((r) => r.id === reminderId)) {
    return NextResponse.json({ error: "slotKey desconhecido" }, { status: 404 });
  }

  const cfg = await getConfig(s.sub);
  const effectiveDate = date ?? nowInTz(cfg.timezone).date;
  const log = await setLogEntry(s.sub, effectiveDate, slotKey, taken);
  return NextResponse.json({ date: effectiveDate, log });
}
