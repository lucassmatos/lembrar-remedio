"use client";

import { useEffect, useMemo, useState } from "react";
import type { DayLog, DoseSlot, Profile, Reminder } from "@/lib/types";
import { slotKey, todaySlots } from "@/lib/schedule";
import { getLog, onChange, setLogEntry } from "@/lib/api";
import { ProfileBadge } from "./profile-badge";

type Props = {
  date: string;
  tz: string;
  reminders: Reminder[];
  profiles?: Profile[];
  nowMinutes: number;
};

const NEAR_WINDOW = 30;

export function TodayList({ date, tz, reminders, profiles = [], nowMinutes }: Props) {
  const profileById = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles],
  );
  const showProfile = profiles.length >= 2;
  const [log, setLog] = useState<DayLog>({});

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

  const slots = useMemo(
    () => todaySlots(reminders, log, { date, tz }),
    [reminders, log, date, tz],
  );

  async function toggle(slot: DoseSlot) {
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
      // revert
      const fresh = await getLog(date).catch(() => ({}));
      setLog(fresh);
    }
  }

  if (slots.length === 0) {
    return (
      <div className="rounded-2xl border border-edge bg-paper-2/60 px-6 py-10 text-center">
        <p className="font-display text-[22px] leading-snug text-ink">
          Sem nada pra hoje.
        </p>
        <p className="mt-2 text-[15px] text-ink-soft">
          Cadastre um medicamento em{" "}
          <a href="/lembretes?tipo=medication" className="underline decoration-edge-2 underline-offset-4 hover:text-ink">
            Medicamentos
          </a>{" "}
          e os horários do dia aparecem aqui.
        </p>
      </div>
    );
  }

  return (
    <ol className="relative">
      {slots.map((slot, i) => (
        <DoseRow
          key={slotKey(slot.reminderId, slot.time) + "-" + i}
          slot={slot}
          profile={showProfile ? profileById.get(slot.reminder.profileId) : undefined}
          nowMinutes={nowMinutes}
          onToggle={() => toggle(slot)}
        />
      ))}
    </ol>
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

  return (
    <li className="border-b border-edge last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="group grid w-full grid-cols-[64px_1fr_auto] items-center gap-4 py-5 text-left"
      >
        <Time time={slot.time} state={slot.taken ? "done" : isMissed ? "missed" : isNow ? "now" : "ahead"} />
        <div className="min-w-0">
          <div
            className={
              "flex items-center gap-2 font-display text-[19px] leading-tight tracking-tight transition-all " +
              (slot.taken ? "text-ink-faint line-through decoration-edge-2" : "text-ink")
            }
          >
            {profile ? <ProfileBadge profile={profile} size={20} /> : null}
            <span className="min-w-0 truncate">{slot.reminder.title}</span>
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
        <Indicator
          state={slot.taken ? "done" : isMissed ? "missed" : isAhead ? "ahead" : "now"}
        />
      </button>
    </li>
  );
}

function Time({
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
