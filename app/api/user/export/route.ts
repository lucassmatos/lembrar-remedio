import { NextResponse } from "next/server";
import { getConfig, getLog, listProfiles, listReminders } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { addDays, nowInTz } from "@/lib/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;

  const [cfg, profiles, reminders] = await Promise.all([
    getConfig(s.sub),
    listProfiles(s.sub),
    listReminders(s.sub),
  ]);

  const { _registered: _r, ...cleanCfg } = cfg;
  void _r;

  const today = nowInTz(cleanCfg.timezone).date;
  const logs: Record<string, unknown> = {};
  for (let i = 0; i < 60; i++) {
    const date = addDays(today, -i);
    const log = await getLog(s.sub, date);
    if (Object.keys(log).length > 0) logs[date] = log;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    user: { sub: s.sub, email: s.email, name: s.name },
    config: cleanCfg,
    profiles,
    reminders,
    log: logs,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="lembrar-remedio-${today}.json"`,
    },
  });
}
