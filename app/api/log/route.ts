import { NextRequest, NextResponse } from "next/server";
import {
  getConfig,
  getLogForProfile,
  listProfilesForUser,
  listRemindersForProfile,
  setLogEntryForProfile,
} from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { requireProfileAccess, mapAccessError } from "@/lib/sharing";
import { nowInTz } from "@/lib/schedule";
import { LogPostSchema, parseBody } from "@/lib/validation";
import type { DayLog } from "@/lib/types";

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

  const grants = await listProfilesForUser(s.sub);
  const logs = await Promise.all(
    grants.map((g) => getLogForProfile(g.profile.id, effectiveDate)),
  );

  // Merge all profile logs into one object (slotKey is globally unique by reminderId).
  const merged: DayLog = Object.assign({}, ...logs);
  return NextResponse.json({ date: effectiveDate, log: merged });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, LogPostSchema);
  if (!parsed.ok) return parsed.response;
  const { date, slotKey, taken } = parsed.data;

  // slotKey is `${reminderId}@HH:MM` — find which accessible profile owns this reminder.
  const [reminderId] = slotKey.split("@");
  const grants = await listProfilesForUser(s.sub);

  let targetProfileId: string | null = null;
  for (const grant of grants) {
    const reminders = await listRemindersForProfile(grant.profile.id);
    if (reminders.some((r) => r.id === reminderId)) {
      targetProfileId = grant.profile.id;
      break;
    }
  }

  if (!targetProfileId) {
    return NextResponse.json({ error: "slotKey desconhecido" }, { status: 404 });
  }

  try {
    await requireProfileAccess(s.sub, targetProfileId, "viewer");
  } catch (e) {
    return mapAccessError(e);
  }

  const cfg = await getConfig(s.sub);
  const effectiveDate = date ?? nowInTz(cfg.timezone).date;
  const log = await setLogEntryForProfile(targetProfileId, effectiveDate, slotKey, taken, s.sub);
  return NextResponse.json({ date: effectiveDate, log });
}
