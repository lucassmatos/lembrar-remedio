import { NextRequest, NextResponse } from "next/server";
import {
  getConfig,
  getLogForProfile,
  listProfilesForUser,
  listRemindersForProfile,
} from "@/lib/ddb";
import { requireDeviceToken } from "@/lib/session";
import {
  applicableLeads,
  daysBetween,
  effectiveStatus,
  nowInTz,
  todaySlots,
} from "@/lib/schedule";
import type { DayLog, Reminder } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Janela (min) em torno do horário pra considerar a dose "agora". Espelha o
// NEAR_WINDOW da Timeline (app/_components/timeline.tsx).
const NEAR_WINDOW = 30;
// Horizonte de dias pra mostrar consultas/vacinas próximas.
const HORIZON_DAYS = 30;

/**
 * Visão "hoje" achatada pro mostrador físico desenhar — doses do dia + consultas/
 * vacinas dentro da janela de aviso. Toda a lógica de agenda é reaproveitada do
 * servidor (lib/schedule), então o firmware fica burro: só renderiza.
 */
export async function GET(req: NextRequest) {
  const auth = await requireDeviceToken(req);
  if (!auth.ok) return auth.response;
  const sub = auth.sub;

  const cfg = await getConfig(sub);
  const tz = cfg.timezone || "America/Sao_Paulo";
  const now = nowInTz(tz);
  const date = now.date;

  const grants = await listProfilesForUser(sub);
  const profiles = grants.map((g) => g.profile);
  const showProfile = profiles.length >= 2;
  const nameById = new Map(profiles.map((p) => [p.id, p.name]));

  const remindersNested = await Promise.all(
    grants.map((g) => listRemindersForProfile(g.profile.id)),
  );
  const reminders: Reminder[] = remindersNested.flat();

  const logs = await Promise.all(
    grants.map((g) => getLogForProfile(g.profile.id, date)),
  );
  const log: DayLog = Object.assign({}, ...logs);

  // ── Doses de hoje (medicamentos daily-interval) ──
  const doses = todaySlots(reminders, log, { date, tz }).map((slot) => {
    const delta = slot.minutes - now.minutes;
    const state = slot.taken
      ? "done"
      : Math.abs(delta) <= NEAR_WINDOW
        ? "now"
        : delta < -NEAR_WINDOW
          ? "missed"
          : "ahead";
    return {
      slotKey: `${slot.reminderId}@${slot.time}`,
      time: slot.time,
      title: slot.reminder.title,
      who: showProfile ? (nameById.get(slot.reminder.profileId) ?? "") : "",
      taken: slot.taken,
      state,
    };
  });

  // ── Consultas/vacinas próximas (one-shot dentro da janela de aviso) ──
  const events = [];
  for (const r of reminders) {
    if (r.schedule.type !== "one-shot") continue;
    if (effectiveStatus(r) === "done") continue;
    const eventDate = r.schedule.date;
    const eventDays = daysBetween(date, eventDate);
    if (eventDays < 0 || eventDays > HORIZON_DAYS) continue;
    const leads = applicableLeads(r);
    const maxLead = leads.length ? Math.max(...leads) : 0;
    events.push({
      title: r.title,
      who: showProfile ? (nameById.get(r.profileId) ?? "") : "",
      kind: r.kind, // "appointment" | "vaccine"
      date: eventDate,
      daysAway: eventDays,
      needsAttention: eventDays <= maxLead,
      scheduled: effectiveStatus(r) === "scheduled",
    });
  }
  events.sort((a, b) => a.daysAway - b.daysAway);

  return NextResponse.json({
    date,
    tz,
    nowMinutes: now.minutes,
    generatedAt: now.iso,
    doses,
    events,
  });
}
