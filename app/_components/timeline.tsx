"use client";

import { useEffect, useMemo, useState } from "react";
import {
  applicableLeads,
  daysBetween,
  effectiveStatus,
  slotKey,
  todaySlots,
} from "@/lib/schedule";
import {
  getLog,
  onChange,
  setLogEntry,
  updateReminder,
} from "@/lib/api";
import type {
  DayLog,
  DoseSlot,
  NapActivity,
  OneShotSchedule,
  Profile,
  Reminder,
  ReminderKind,
  ReminderStatus,
} from "@/lib/types";
import { clock, formatDuration } from "@/lib/activity";
import { KIND_META, KIND_ORDER, isReminderKind } from "@/lib/reminder-kinds";
import { ProfileBadge } from "./profile-badge";

type Props = {
  date: string;
  tz: string;
  reminders: Reminder[];
  profiles?: Profile[];
  openNaps?: NapActivity[];
  nowMinutes: number;
};

const NEAR_WINDOW = 30;
const HORIZON_DAYS = 90;
const KINDS_KEY = "lr.timeline.kinds.v1";

type OneShotEntry = {
  reminder: Reminder;
  schedule: OneShotSchedule;
  eventDate: string;
  eventDays: number;
  status: ReminderStatus;
  needsAttention: boolean;
};

export function Timeline({ date, tz, reminders, profiles = [], openNaps = [], nowMinutes }: Props) {
  const profileById = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles],
  );
  const showProfile = profiles.length >= 2;
  const [log, setLog] = useState<DayLog>({});
  const [enabledKinds, setEnabledKinds] = useState<Set<ReminderKind>>(
    () => new Set(KIND_ORDER),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(KINDS_KEY);
    if (stored === null) return;
    setEnabledKinds(new Set(stored.split(",").filter(isReminderKind)));
  }, []);

  function toggleKind(k: ReminderKind) {
    setEnabledKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      if (typeof window !== "undefined") {
        localStorage.setItem(KINDS_KEY, KIND_ORDER.filter((x) => next.has(x)).join(","));
      }
      return next;
    });
  }

  const kindsPresent = useMemo(() => {
    const set = new Set<ReminderKind>();
    for (const r of reminders) set.add(r.kind);
    return set;
  }, [reminders]);

  useEffect(() => {
    let cancelled = false;
    async function fetchLog() {
      try {
        const next = await getLog(date);
        if (!cancelled) setLog(next);
      } catch {
        // ignore
      }
    }
    fetchLog();
    const off = onChange("log", fetchLog);
    return () => {
      cancelled = true;
      off();
    };
  }, [date]);

  const meds = useMemo(
    () => reminders.filter((r) => r.kind === "medication" && enabledKinds.has("medication")),
    [reminders, enabledKinds],
  );

  const todaySlotItems = useMemo(
    () => todaySlots(meds, log, { date, tz }),
    [meds, log, date, tz],
  );

  // Uma linha por evento (consulta/vacina), não por aviso. A data exibida é a do
  // evento, nunca a do aviso. Não-agendados entram em "Hoje" assim que a janela de
  // aviso abre (D-maxLead, ex. D-30) pra forçar a marcar; agendados só na véspera/dia.
  const oneShotItems = useMemo<OneShotEntry[]>(() => {
    const out: OneShotEntry[] = [];
    for (const r of reminders) {
      if (r.schedule.type !== "one-shot") continue;
      if (!enabledKinds.has(r.kind)) continue;
      const status = effectiveStatus(r);
      if (status === "done") continue;
      const eventDate = r.schedule.date;
      const eventDays = daysBetween(date, eventDate);
      if (eventDays < 0) continue;
      if (eventDays > HORIZON_DAYS) continue;
      const leads = applicableLeads(r);
      const maxLead = leads.length ? Math.max(...leads) : 0;
      out.push({
        reminder: r,
        schedule: r.schedule,
        eventDate,
        eventDays,
        status,
        needsAttention: eventDays <= maxLead,
      });
    }
    out.sort((a, b) => a.eventDays - b.eventDays);
    return out;
  }, [reminders, date, enabledKinds]);

  const todayOneShots = oneShotItems.filter((o) => o.needsAttention);
  const upcomingOneShots = oneShotItems.filter((o) => !o.needsAttention);

  async function toggleSlot(slot: DoseSlot) {
    const key = slotKey(slot.reminderId, slot.time);
    const next = !slot.taken;
    setLog((prev) => {
      const copy = { ...prev };
      if (next) copy[key] = { taken: true, takenAt: Date.now() };
      else delete copy[key];
      return copy;
    });
    try {
      const updated = await setLogEntry(date, key, next);
      setLog(updated);
    } catch {
      const fresh = await getLog(date).catch(() => ({}));
      setLog(fresh);
    }
  }

  async function setStatus(id: string, status: "unscheduled" | "scheduled" | "done") {
    await updateReminder(id, { status });
  }

  const todayEmpty = todaySlotItems.length === 0 && todayOneShots.length === 0;

  return (
    <div>
      {openNaps.length > 0 ? (
        <SleepingBanner
          naps={openNaps}
          tz={tz}
          profileById={showProfile ? profileById : undefined}
        />
      ) : null}

      {kindsPresent.size >= 2 ? (
        <div className="mb-8 flex flex-wrap gap-2">
          {KIND_ORDER.filter((k) => kindsPresent.has(k)).map((k) => {
            const on = enabledKinds.has(k);
            const m = KIND_META[k];
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => toggleKind(k)}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-all " +
                  (on
                    ? "bg-ink text-paper"
                    : "border border-edge-2 text-ink-faint hover:border-ink-soft hover:text-ink-soft")
                }
              >
                <span aria-hidden className={"text-[14px] leading-none " + (on ? "" : "opacity-50")}>
                  {m.icon}
                </span>
                {m.plural}
              </button>
            );
          })}
        </div>
      ) : null}

      <section className="mb-12">
        <h2 className="mb-4 font-display text-[18px] tracking-tight text-ink-soft">
          Hoje
        </h2>
        {todayEmpty ? (
          <p className="py-2 text-[15px] text-ink-soft">Nada pra hoje.</p>
        ) : (
          <ol className="relative divide-y divide-edge">
            {todaySlotItems.map((slot, i) => (
              <DoseRow
                key={slotKey(slot.reminderId, slot.time) + "-" + i}
                slot={slot}
                profile={showProfile ? profileById.get(slot.reminder.profileId) : undefined}
                nowMinutes={nowMinutes}
                onToggle={() => toggleSlot(slot)}
              />
            ))}
            {todayOneShots.map((item) => (
              <OneShotRow
                key={item.reminder.id}
                item={item}
                profile={showProfile ? profileById.get(item.reminder.profileId) : undefined}
                onAgendei={() => setStatus(item.reminder.id, "scheduled")}
                onDesmarcar={() => setStatus(item.reminder.id, "unscheduled")}
                onFiz={() => setStatus(item.reminder.id, "done")}
              />
            ))}
          </ol>
        )}
      </section>

      {upcomingOneShots.length > 0 ? (
        <section>
          <h2 className="mb-4 font-display text-[18px] tracking-tight text-ink-soft">
            Próximos
          </h2>
          <ol className="divide-y divide-edge">
            {upcomingOneShots.map((item) => (
              <OneShotRow
                key={item.reminder.id}
                item={item}
                profile={showProfile ? profileById.get(item.reminder.profileId) : undefined}
                onAgendei={() => setStatus(item.reminder.id, "scheduled")}
                onDesmarcar={() => setStatus(item.reminder.id, "unscheduled")}
                onFiz={() => setStatus(item.reminder.id, "done")}
              />
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function SleepingBanner({
  naps,
  tz,
  profileById,
}: {
  naps: NapActivity[];
  tz: string;
  profileById?: Map<string, Profile>;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="mb-8 grid gap-2">
      {naps.map((nap) => {
        const profile = profileById?.get(nap.profileId);
        return (
          <div
            key={nap.id}
            className="flex items-center gap-3 rounded-2xl border border-edge px-5 py-4"
            style={{ background: "var(--color-paper-2)" }}
          >
            <span
              aria-hidden
              className="text-[22px] leading-none"
              style={{ animation: "ring-pulse 2.4s ease-in-out infinite", borderRadius: 12 }}
            >
              😴
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-display text-[19px] tracking-tight text-ink">
                {profile ? <ProfileBadge profile={profile} size={20} /> : null}
                <span className="truncate">
                  {profile ? `${profile.name} dormindo` : "dormindo agora"}
                </span>
              </div>
              <div className="mt-0.5 text-[13px] text-ink-soft tnum">
                desde {clock(nap.startedAt, tz)} · {formatDuration(now - nap.startedAt)}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function DoseRow({
  slot,
  profile,
  nowMinutes,
  onToggle,
}: {
  slot: DoseSlot;
  profile?: Profile;
  nowMinutes: number;
  onToggle: () => void;
}) {
  const delta = slot.minutes - nowMinutes;
  const isNow = !slot.taken && Math.abs(delta) <= NEAR_WINDOW;
  const isMissed = !slot.taken && delta < -NEAR_WINDOW;
  const isAhead = !slot.taken && delta > NEAR_WINDOW;
  const state = slot.taken ? "done" : isMissed ? "missed" : isNow ? "now" : "ahead";

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="group grid w-full grid-cols-[64px_1fr_auto] items-center gap-4 py-5 text-left"
      >
        <TimeChip time={slot.time} state={state} />
        <div className="min-w-0">
          <div
            className={
              "flex items-center gap-2 font-display text-[19px] leading-tight tracking-tight transition-all " +
              (slot.taken ? "text-ink-faint line-through decoration-edge-2" : "text-ink")
            }
          >
            <span aria-hidden className="text-[15px] leading-none">💊</span>
            {profile ? <ProfileBadge profile={profile} size={20} /> : null}
            <span className="min-w-0">{slot.reminder.title}</span>
          </div>
          <div className="mt-1 text-[13px] tnum text-ink-faint">
            {slot.reminder.subtitle
              ? slot.reminder.subtitle
              : slot.reminder.schedule.type === "daily-interval"
                ? `a cada ${slot.reminder.schedule.intervalHours}h`
                : ""}
            {slot.taken && slot.takenAt ? (
              <>
                <span className="mx-1.5 text-ink-faint/60">·</span>
                tomado às {fmtTakenAt(slot.takenAt)}
              </>
            ) : null}
            {slot.taken && slot.takenByName ? (
              <div className="mt-0.5 text-[12px] text-ink-faint">
                marcado por {slot.takenByName}
              </div>
            ) : null}
          </div>
        </div>
        <Indicator state={isAhead ? "ahead" : isNow ? "now" : isMissed ? "missed" : "done"} />
      </button>
    </li>
  );
}

function OneShotRow({
  item,
  profile,
  onAgendei,
  onDesmarcar,
  onFiz,
}: {
  item: OneShotEntry;
  profile?: Profile;
  onAgendei: () => void;
  onDesmarcar: () => void;
  onFiz: () => void;
}) {
  const meta = KIND_META[item.reminder.kind] ?? KIND_META.appointment;
  const unscheduled = item.status === "unscheduled";

  return (
    <li>
      <div className="flex items-center gap-4 py-5">
        {/* data + owner */}
        <div className="w-[86px] shrink-0">
          <DateChip eventDate={item.eventDate} eventDays={item.eventDays} />
          {profile ? (
            <div className="mt-2.5 flex items-center gap-1.5 text-[12px] text-ink-faint">
              <ProfileBadge profile={profile} size={14} />
              <span className="min-w-0 truncate">{profile.name}</span>
            </div>
          ) : null}
        </div>

        {/* nome + especialidade */}
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[20px] leading-snug tracking-tight text-ink">
            {item.reminder.title}
          </h3>
          {item.reminder.subtitle ? (
            <p className="mt-0.5 text-[13px] text-ink-faint">{item.reminder.subtitle}</p>
          ) : null}
        </div>

        {/* status + ação */}
        <div className="flex shrink-0 flex-col items-end gap-2 text-[12px]">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="text-[12px] leading-none">{meta.icon}</span>
            <span className={unscheduled ? "font-medium text-amber" : "text-ink-soft"}>
              {unscheduled ? "Agendar" : "Agendada"}
            </span>
          </span>
          <button
            type="button"
            onClick={unscheduled ? onAgendei : onFiz}
            className="rounded-full px-3 py-1.5 text-ink-soft transition-colors hover:text-ink"
            style={{ border: "1px solid var(--color-edge-2)" }}
          >
            {unscheduled ? "já agendei" : "Realizada"}
          </button>
          {unscheduled ? null : (
            <button
              type="button"
              onClick={onDesmarcar}
              className="text-ink-faint underline decoration-edge-2 underline-offset-4 transition-colors hover:text-ink"
            >
              desmarcar
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function TimeChip({
  time,
  state,
}: {
  time: string;
  state: "done" | "missed" | "now" | "ahead";
}) {
  const color =
    state === "done"
      ? "text-ink-faint"
      : state === "missed"
        ? "text-clay"
        : state === "now"
          ? "text-ink"
          : "text-ink-soft";
  return (
    <div className={"tnum text-[26px] leading-none tracking-tight transition-colors " + color}>
      {time}
    </div>
  );
}

function DateChip({ eventDate, eventDays }: { eventDate: string; eventDays: number }) {
  const [, m, d] = eventDate.split("-");
  if (eventDays === 0) {
    return (
      <div className="text-[11px] uppercase tracking-[0.16em] text-amber">hoje</div>
    );
  }
  if (eventDays === 1) {
    return (
      <div className="text-[11px] uppercase tracking-[0.16em] text-ink-soft">
        amanhã
      </div>
    );
  }
  return (
    <div className="tnum text-[15px] tracking-tight text-ink-soft">
      {d}/{m}
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        em {eventDays}d
      </div>
    </div>
  );
}

function Indicator({ state }: { state: "done" | "missed" | "now" | "ahead" }) {
  if (state === "done") {
    return (
      <span
        aria-label="tomado"
        className="grid size-7 place-items-center rounded-full"
        style={{ background: "var(--color-sage-soft)", color: "var(--color-sage)" }}
      >
        <CheckIcon />
      </span>
    );
  }
  if (state === "now") {
    return (
      <span
        aria-label="agora"
        className="pulse-amber grid size-7 place-items-center rounded-full"
        style={{ background: "var(--color-amber-soft)" }}
      >
        <span className="block size-2 rounded-full" style={{ background: "var(--color-amber)" }} />
      </span>
    );
  }
  if (state === "missed") {
    return (
      <span
        aria-label="atrasado"
        className="grid size-7 place-items-center rounded-full"
        style={{
          background: "var(--color-clay-soft)",
          color: "var(--color-clay)",
          boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--color-clay) 25%, transparent)",
        }}
      >
        <span className="block size-1.5 rounded-full" style={{ background: "var(--color-clay)" }} />
      </span>
    );
  }
  return (
    <span
      aria-label="pendente"
      className="block size-7 rounded-full transition-colors group-hover:[box-shadow:inset_0_0_0_1px_var(--color-ink-faint)]"
      style={{ boxShadow: "inset 0 0 0 1px var(--color-edge-2)" }}
    />
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function fmtTakenAt(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
