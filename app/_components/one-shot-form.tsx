"use client";

import { useMemo, useState } from "react";
import { addReminder, updateReminder } from "@/lib/api";
import {
  DEFAULT_POST_LEADS,
  DEFAULT_PRE_LEADS,
  type OneShotSchedule,
  type Reminder,
  type ReminderKind,
  type ReminderStatus,
} from "@/lib/types";

const STATUS_OPTIONS: { value: ReminderStatus; label: string }[] = [
  { value: "unscheduled", label: "à marcar" },
  { value: "scheduled", label: "agendado" },
  { value: "done", label: "feito" },
];

const LEAD_CHIPS = [30, 15, 7, 3, 1, 0];

type Props = {
  reminder?: Reminder;
  profileId?: string;
  defaultKind?: ReminderKind;
  onSaved?: (r: Reminder) => void;
  onCancel?: () => void;
};

function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function leadsFromReminder(r?: Reminder): number[] {
  if (!r) return [];
  const set = new Set<number>([
    ...(r.preLeadDays ?? []),
    ...(r.postLeadDays ?? []),
  ]);
  return Array.from(set).sort((a, b) => b - a);
}

function defaultLeadsFor(kind: ReminderKind): number[] {
  return [
    ...(DEFAULT_PRE_LEADS[kind] ?? []),
    ...(DEFAULT_POST_LEADS[kind] ?? []),
  ].sort((a, b) => b - a);
}

export function OneShotForm({
  reminder,
  profileId,
  defaultKind = "appointment",
  onSaved,
  onCancel,
}: Props) {
  const editing = !!reminder;
  const oneShot =
    reminder?.schedule.type === "one-shot" ? (reminder.schedule as OneShotSchedule) : null;
  const initialKind: ReminderKind = editing
    ? (reminder?.kind ?? defaultKind)
    : defaultKind;

  const [kind] = useState<ReminderKind>(initialKind);
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [subtitle, setSubtitle] = useState(reminder?.subtitle ?? "");
  const [date, setDate] = useState(oneShot?.date ?? "");
  const [time, setTime] = useState(oneShot?.time ?? "");
  const initialLeads = editing ? leadsFromReminder(reminder) : defaultLeadsFor(defaultKind);
  const [leads, setLeads] = useState<number[]>(initialLeads);
  const [status, setStatus] = useState<ReminderStatus>(reminder?.status ?? "unscheduled");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sortedLeads = useMemo(() => [...leads].sort((a, b) => b - a), [leads]);

  function toggleLead(d: number) {
    setLeads((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!title.trim()) {
      setErr(kind === "vaccine" ? "Dá um nome pra vacina." : "Dá o nome do médico.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setErr("Data inválida.");
      return;
    }
    if (time && !/^\d{2}:\d{2}$/.test(time)) {
      setErr("Hora inválida.");
      return;
    }
    setBusy(true);
    try {
      const schedule: OneShotSchedule = { type: "one-shot", date };
      if (time) schedule.time = time;
      const preLeadDays = sortedLeads.filter((d) => d >= 2);
      const postLeadDays = sortedLeads.filter((d) => d <= 1);

      let saved: Reminder;
      if (editing && reminder) {
        saved = await updateReminder(reminder.id, {
          title: title.trim(),
          subtitle: subtitle.trim() || undefined,
          schedule,
          preLeadDays,
          postLeadDays,
          status,
        });
      } else {
        saved = await addReminder({
          kind,
          title: title.trim(),
          subtitle: subtitle.trim() || undefined,
          schedule,
          preLeadDays,
          postLeadDays,
          profileId: profileId ?? "",
        });
      }
      if (!editing) {
        setTitle("");
        setSubtitle("");
        setDate("");
        setTime("");
        setLeads(defaultLeadsFor(kind));
      }
      onSaved?.(saved);
    } catch {
      setErr("Não rolou. Tenta de novo.");
    } finally {
      setBusy(false);
    }
  }

  const titlePlaceholder = kind === "vaccine" ? "Influenza 2026" : "Dr. Silva";
  const subtitlePlaceholder = kind === "vaccine" ? "tetra viral" : "Cardiologista";
  const titleLabel = kind === "appointment" ? "Nome do médico" : "Nome";
  const subtitleLabel = kind === "vaccine" ? "Detalhe" : "Especialidade";

  return (
    <form onSubmit={submit} className="space-y-7">
      <div>
        <label className="mb-2 block text-[12px] uppercase tracking-[0.16em] text-ink-faint">
          {titleLabel}
        </label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={titlePlaceholder}
          className="w-full bg-transparent pb-2 font-display text-[28px] leading-tight tracking-tight text-ink outline-none placeholder:text-ink-faint/60"
          style={{ borderBottom: "1px solid var(--color-edge-2)" }}
        />
      </div>

      <div>
        <label className="mb-2 block text-[12px] uppercase tracking-[0.16em] text-ink-faint">
          {subtitleLabel}
          {kind === "vaccine" ? (
            <span className="lowercase tracking-normal text-ink-faint/60"> (opcional)</span>
          ) : null}
        </label>
        <input
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder={subtitlePlaceholder}
          className="w-full bg-transparent pb-2 text-[16px] text-ink outline-none placeholder:text-ink-faint/60"
          style={{ borderBottom: "1px solid var(--color-edge-2)" }}
        />
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-6">
        <div>
          <label className="mb-2 block text-[12px] uppercase tracking-[0.16em] text-ink-faint">
            Data
          </label>
          <input
            type="date"
            value={date}
            min={todayDate()}
            onChange={(e) => setDate(e.target.value)}
            className="w-full bg-transparent pb-2 text-[16px] tnum text-ink outline-none"
            style={{ borderBottom: "1px solid var(--color-edge-2)" }}
          />
        </div>
        <div>
          <label className="mb-2 block text-[12px] uppercase tracking-[0.16em] text-ink-faint">
            Hora <span className="lowercase tracking-normal text-ink-faint/60">(opcional)</span>
          </label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full bg-transparent pb-2 text-[16px] tnum text-ink outline-none"
            style={{ borderBottom: "1px solid var(--color-edge-2)" }}
          />
        </div>
      </div>

      <div>
        <label className="mb-3 block text-[12px] uppercase tracking-[0.16em] text-ink-faint">
          Me avise
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {LEAD_CHIPS.map((d) => {
            const active = leads.includes(d);
            const label = d === 0 ? "no dia" : d === 1 ? "1 dia antes" : `${d}d antes`;
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleLead(d)}
                className={
                  "rounded-full px-3.5 py-1.5 text-[14px] transition-all " +
                  (active
                    ? "bg-ink text-paper"
                    : "border border-edge-2 text-ink-soft hover:border-ink-soft hover:text-ink")
                }
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-ink-faint">
          {kind === "vaccine" || kind === "appointment"
            ? "Antes de agendar, peço pra você marcar. Depois, lembro mais perto."
            : ""}
        </p>
      </div>

      {editing ? (
        <div>
          <label className="mb-3 block text-[12px] uppercase tracking-[0.16em] text-ink-faint">
            Estado
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_OPTIONS.map((o) => {
              const active = status === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setStatus(o.value)}
                  className={
                    "rounded-full px-3.5 py-1.5 text-[14px] transition-all " +
                    (active
                      ? "bg-ink text-paper"
                      : "border border-edge-2 text-ink-soft hover:border-ink-soft hover:text-ink")
                  }
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {err ? (
        <p className="text-[14px]" style={{ color: "var(--color-clay)" }}>
          {err}
        </p>
      ) : null}

      <div className="flex items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium tracking-tight text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Salvando" : editing ? "Salvar" : "Adicionar"}
        </button>
        {editing ? (
          <button
            type="button"
            onClick={onCancel}
            className="text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
          >
            cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}
