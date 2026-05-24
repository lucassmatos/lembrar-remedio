"use client";

import { useEffect, useMemo, useState } from "react";
import { deleteReminder, getConfig, updateReminder } from "@/lib/api";
import {
  daysBetween,
  formatBrDate,
  nowInTz,
} from "@/lib/schedule";
import type { OneShotSchedule, Profile, Reminder } from "@/lib/types";
import { OneShotForm } from "./one-shot-form";
import { ProfileBadge } from "./profile-badge";

type Tab = "upcoming" | "history";

type Item = {
  reminder: Reminder;
  schedule: OneShotSchedule;
  daysAway: number;
};

const KIND_META = {
  vaccine: { icon: "💉", noun: "Vacina" },
  appointment: { icon: "📅", noun: "Consulta" },
  medication: { icon: "💊", noun: "Medicamento" },
} as const;

export function UpcomingList({
  reminders,
  profiles = [],
  hideKindTag = false,
  emptyUpcoming = "Nada agendado por aqui.",
  emptyHistory = "Nada no histórico ainda.",
}: {
  reminders: Reminder[];
  profiles?: Profile[];
  hideKindTag?: boolean;
  emptyUpcoming?: string;
  emptyHistory?: string;
}) {
  const [tz, setTz] = useState("America/Sao_Paulo");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("upcoming");

  useEffect(() => {
    let cancelled = false;
    getConfig()
      .then((c) => {
        if (!cancelled) setTz(c.timezone);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const today = nowInTz(tz).date;
  const showProfile = profiles.length >= 2;
  const profileById = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles],
  );

  const { upcoming, history } = useMemo(() => {
    const upc: Item[] = [];
    const hist: Item[] = [];
    for (const r of reminders) {
      if (r.schedule.type !== "one-shot") continue;
      const sch = r.schedule;
      const days = daysBetween(today, sch.date);
      const item = { reminder: r, schedule: sch, daysAway: days };
      const isPast = days < 0;
      const isDone = r.status === "done";
      if (isDone || isPast) hist.push(item);
      else upc.push(item);
    }
    upc.sort((a, b) => a.daysAway - b.daysAway);
    hist.sort((a, b) => b.schedule.date.localeCompare(a.schedule.date));
    return { upcoming: upc, history: hist };
  }, [reminders, today]);

  async function remove(id: string, title: string) {
    if (!confirm(`Apagar ${title}?`)) return;
    await deleteReminder(id);
    if (editingId === id) setEditingId(null);
  }

  async function setStatus(id: string, status: "unscheduled" | "scheduled" | "done") {
    await updateReminder(id, { status });
  }

  const list = tab === "upcoming" ? upcoming : history;

  return (
    <div>
      <div className="mb-5 flex items-baseline gap-6 text-[14px]">
        <TabButton active={tab === "upcoming"} onClick={() => setTab("upcoming")}>
          Próximos
          {upcoming.length > 0 ? (
            <span className="ml-1.5 tnum text-ink-faint">{upcoming.length}</span>
          ) : null}
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          Histórico
          {history.length > 0 ? (
            <span className="ml-1.5 tnum text-ink-faint">{history.length}</span>
          ) : null}
        </TabButton>
      </div>

      {list.length === 0 ? (
        <p className="py-6 text-[15px] text-ink-soft">
          {tab === "upcoming" ? emptyUpcoming : emptyHistory}
        </p>
      ) : (
        <ul className="divide-y divide-edge">
          {list.map((item) => {
            const { reminder, schedule, daysAway } = item;
            const isEditing = editingId === reminder.id;
            const meta = KIND_META[reminder.kind] ?? KIND_META.appointment;
            const profile = profileById.get(reminder.profileId);
            const state = computeState(reminder, daysAway);
            return (
              <li key={reminder.id} className="py-5">
                {isEditing ? (
                  <div className="rounded-2xl border border-edge bg-paper-2/40 p-5">
                    <OneShotForm
                      reminder={reminder}
                      onSaved={() => setEditingId(null)}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-[1fr_auto] items-start gap-4">
                    <div className="min-w-0">
                      {hideKindTag ? (
                        showProfile && profile ? (
                          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-ink-faint">
                            <ProfileBadge profile={profile} size={14} />
                            <span>{profile.name}</span>
                          </div>
                        ) : null
                      ) : (
                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-ink-faint">
                          <span aria-hidden>{meta.icon}</span>
                          {meta.noun}
                          {showProfile && profile ? (
                            <>
                              <span className="text-ink-faint/40">·</span>
                              <ProfileBadge profile={profile} size={14} />
                              <span className="text-ink-faint">{profile.name}</span>
                            </>
                          ) : null}
                        </div>
                      )}
                      <div className="mt-1.5 font-display text-[20px] leading-tight tracking-tight text-ink">
                        {reminder.title}
                      </div>
                      {reminder.subtitle ? (
                        <div className="mt-1 text-[13px] text-ink-soft">
                          {reminder.subtitle}
                        </div>
                      ) : null}
                      <div className="mt-2 flex items-center gap-2 text-[13px] tnum">
                        <span className="text-ink-soft">
                          {formatBrDate(schedule.date)}
                          {schedule.time ? `, ${schedule.time}` : ""}
                        </span>
                        <span className="text-ink-faint/50">·</span>
                        <span className="text-ink-faint">
                          {relativeLabel(daysAway)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-3">
                      <StatePill state={state} />
                      <div className="flex items-center gap-3 text-[13px]">
                        {tab === "upcoming" && reminder.status === "unscheduled" ? (
                          <button
                            type="button"
                            onClick={() => setStatus(reminder.id, "scheduled")}
                            className="text-ink-soft underline decoration-edge-2 underline-offset-4 hover:text-ink"
                          >
                            agendei
                          </button>
                        ) : null}
                        {tab === "upcoming" && reminder.status === "scheduled" ? (
                          <button
                            type="button"
                            onClick={() => setStatus(reminder.id, "done")}
                            className="text-ink-soft underline decoration-edge-2 underline-offset-4 hover:text-ink"
                          >
                            fiz
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setEditingId(reminder.id)}
                          className="text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
                        >
                          editar
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(reminder.id, reminder.title)}
                          className="text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-clay"
                        >
                          apagar
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type State =
  | { kind: "unscheduled-urgent" }
  | { kind: "unscheduled" }
  | { kind: "scheduled" }
  | { kind: "due" }
  | { kind: "done" }
  | { kind: "missed" };

function computeState(reminder: Reminder, daysAway: number): State {
  if (reminder.status === "done") return { kind: "done" };
  if (daysAway < 0) return { kind: "missed" };
  if (daysAway === 0) return { kind: "due" };
  if (reminder.status === "scheduled") return { kind: "scheduled" };
  if (daysAway <= 7) return { kind: "unscheduled-urgent" };
  return { kind: "unscheduled" };
}

function StatePill({ state }: { state: State }) {
  const { label, fg, bg } = pillStyle(state);
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] tracking-tight"
      style={{ color: fg, background: bg }}
    >
      {label}
    </span>
  );
}

function pillStyle(state: State): { label: string; fg: string; bg: string } {
  switch (state.kind) {
    case "scheduled":
      return {
        label: "agendado",
        fg: "var(--color-sage)",
        bg: "var(--color-sage-soft)",
      };
    case "unscheduled-urgent":
      return {
        label: "marque",
        fg: "var(--color-amber)",
        bg: "var(--color-amber-soft)",
      };
    case "unscheduled":
      return {
        label: "à marcar",
        fg: "var(--color-ink-soft)",
        bg: "var(--color-paper-2)",
      };
    case "due":
      return {
        label: "hoje",
        fg: "var(--color-amber)",
        bg: "var(--color-amber-soft)",
      };
    case "missed":
      return {
        label: "passou",
        fg: "var(--color-clay)",
        bg: "var(--color-clay-soft)",
      };
    case "done":
      return {
        label: "feito",
        fg: "var(--color-ink-soft)",
        bg: "var(--color-paper-2)",
      };
  }
}

function relativeLabel(daysAway: number): string {
  if (daysAway === 0) return "hoje";
  if (daysAway === 1) return "amanhã";
  if (daysAway === -1) return "ontem";
  if (daysAway > 0) {
    if (daysAway < 7) return `daqui ${daysAway} dias`;
    if (daysAway < 30) {
      const w = Math.round(daysAway / 7);
      return w === 1 ? "daqui 1 semana" : `daqui ${w} semanas`;
    }
    const m = Math.round(daysAway / 30);
    return m === 1 ? "daqui 1 mês" : `daqui ${m} meses`;
  }
  const ago = Math.abs(daysAway);
  if (ago < 30) return `há ${ago} dias`;
  const m = Math.round(ago / 30);
  return m === 1 ? "há 1 mês" : `há ${m} meses`;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "pb-1 tracking-tight transition-colors " +
        (active
          ? "text-ink"
          : "text-ink-faint hover:text-ink-soft")
      }
      style={{
        borderBottom: active
          ? "1.5px solid var(--color-ink)"
          : "1.5px solid transparent",
      }}
    >
      {children}
    </button>
  );
}
