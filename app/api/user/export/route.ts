import { NextResponse } from "next/server";
import {
  getConfig,
  getLogForProfile,
  listProfilesForUser,
  listRemindersForProfile,
} from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { addDays, nowInTz } from "@/lib/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;

  const [cfg, grants] = await Promise.all([
    getConfig(s.sub),
    listProfilesForUser(s.sub),
  ]);
  const profiles = grants.map((g) => ({
    ...g.profile,
    accessRole: g.accessRole,
    // Drop internal Google subs of other members — keep only role + addedAt.
    sharedWith: (g.profile.sharedWith ?? []).map((e) => ({
      role: e.role,
      addedAt: e.addedAt,
    })),
  }));
  const reminderLists = await Promise.all(
    grants.map((g) => listRemindersForProfile(g.profile.id)),
  );
  const reminders = reminderLists.flat();

  const { _registered: _r, ...cleanCfg } = cfg;
  void _r;

  const today = nowInTz(cleanCfg.timezone).date;
  const logs: Record<string, unknown> = {};
  for (let i = 0; i < 60; i++) {
    const date = addDays(today, -i);
    const perProfile = await Promise.all(
      grants.map((g) => getLogForProfile(g.profile.id, date)),
    );
    const merged = Object.assign({}, ...perProfile) as Record<string, unknown>;
    // Strip internal takenBy (Google sub) from each log entry — keep
    // takenByName / taken / takenAt.
    const sanitized: Record<string, unknown> = {};
    for (const [slotKey, val] of Object.entries(merged)) {
      if (val && typeof val === "object") {
        const { takenBy: _takenBy, ...rest } = val as Record<string, unknown>;
        void _takenBy;
        sanitized[slotKey] = rest;
      } else {
        sanitized[slotKey] = val;
      }
    }
    if (Object.keys(sanitized).length > 0) logs[date] = sanitized;
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
