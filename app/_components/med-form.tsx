"use client";

import { useState } from "react";
import { addMed, updateMed } from "@/lib/api";
import type { Medication } from "@/lib/types";

const INTERVAL_CHIPS = [4, 6, 8, 12, 24];
const DURATION_CHIPS = [5, 7, 10, 14, 30];

type Props = {
  med?: Medication;
  profileId?: string;
  onSaved?: (m: Medication) => void;
  onCancel?: () => void;
};

function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function MedForm({ med, profileId, onSaved, onCancel }: Props) {
  const editing = !!med;
  const [name, setName] = useState(med?.name ?? "");
  const [dosage, setDosage] = useState(med?.dosage ?? "");
  const [intervalHours, setIntervalHours] = useState<number | "">(med?.intervalHours ?? 8);
  const [startTime, setStartTime] = useState(med?.startTime ?? "08:00");
  const [durationDays, setDurationDays] = useState<number | "" | "none">(
    med?.durationDays ?? "none",
  );
  const [startDate, setStartDate] = useState<string>(med?.startDate ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr("Dá um nome pro remédio.");
    if (!intervalHours || Number(intervalHours) <= 0)
      return setErr("Intervalo precisa ser maior que zero.");
    if (typeof durationDays === "number" && durationDays <= 0)
      return setErr("Duração precisa ser maior que zero.");
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate))
      return setErr("Data de início inválida.");
    setBusy(true);
    try {
      const duration = typeof durationDays === "number" ? durationDays : undefined;
      const start = startDate || undefined;
      let saved: Medication;
      if (editing && med) {
        saved = await updateMed(med.id, {
          name: name.trim(),
          dosage: dosage.trim() || undefined,
          intervalHours: Number(intervalHours),
          startTime,
          times: undefined,
          durationDays: duration === undefined ? null : duration,
          startDate: start === undefined ? null : start,
        } as Partial<Medication>);
      } else {
        saved = await addMed({
          name: name.trim(),
          dosage: dosage.trim() || undefined,
          intervalHours: Number(intervalHours),
          startTime,
          profileId: profileId ?? "",
          durationDays: duration,
          startDate: start,
        });
      }
      if (!editing) {
        setName("");
        setDosage("");
        setIntervalHours(8);
        setStartTime("08:00");
        setDurationDays("none");
        setStartDate("");
      }
      onSaved?.(saved);
    } catch {
      setErr("Não rolou. Tenta de novo.");
    } finally {
      setBusy(false);
    }
  }

  const customDuration =
    typeof durationDays === "number" && !DURATION_CHIPS.includes(durationDays);

  return (
    <form onSubmit={submit} className="space-y-7">
      <div>
        <label className="mb-2 block text-[12px] uppercase tracking-[0.16em] text-ink-faint">
          Nome
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Paracetamol"
          className="w-full bg-transparent pb-2 font-display text-[28px] leading-tight tracking-tight text-ink outline-none placeholder:text-ink-faint/60"
          style={{ borderBottom: "1px solid var(--color-edge-2)" }}
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="mb-2 block text-[12px] uppercase tracking-[0.16em] text-ink-faint">
            Dose
          </label>
          <input
            value={dosage}
            onChange={(e) => setDosage(e.target.value)}
            placeholder="1 comprimido"
            className="w-full bg-transparent pb-2 text-[16px] text-ink outline-none placeholder:text-ink-faint/60"
            style={{ borderBottom: "1px solid var(--color-edge-2)" }}
          />
        </div>
        <div>
          <label className="mb-2 block text-[12px] uppercase tracking-[0.16em] text-ink-faint">
            Primeira hora
          </label>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full bg-transparent pb-2 text-[16px] tnum text-ink outline-none"
            style={{ borderBottom: "1px solid var(--color-edge-2)" }}
          />
        </div>
      </div>

      <div>
        <label className="mb-3 block text-[12px] uppercase tracking-[0.16em] text-ink-faint">
          De quantas em quantas horas
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {INTERVAL_CHIPS.map((h) => {
            const active = intervalHours === h;
            return (
              <button
                key={h}
                type="button"
                onClick={() => setIntervalHours(h)}
                className={
                  "rounded-full px-3.5 py-1.5 text-[14px] tnum transition-all " +
                  (active
                    ? "bg-ink text-paper"
                    : "border border-edge-2 text-ink-soft hover:border-ink-soft hover:text-ink")
                }
              >
                {h}h
              </button>
            );
          })}
          <span className="mx-1 text-ink-faint">ou</span>
          <input
            type="number"
            min={1}
            max={48}
            value={typeof intervalHours === "number" && !INTERVAL_CHIPS.includes(intervalHours) ? intervalHours : ""}
            onChange={(e) => setIntervalHours(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="outro"
            className="w-20 rounded-full border border-edge-2 bg-transparent px-3 py-1.5 text-center text-[14px] tnum text-ink outline-none placeholder:text-ink-faint/60 focus:border-ink"
          />
        </div>
      </div>

      <div>
        <label className="mb-3 block text-[12px] uppercase tracking-[0.16em] text-ink-faint">
          Por quantos dias
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDurationDays("none")}
            className={
              "rounded-full px-3.5 py-1.5 text-[14px] transition-all " +
              (durationDays === "none"
                ? "bg-ink text-paper"
                : "border border-edge-2 text-ink-soft hover:border-ink-soft hover:text-ink")
            }
          >
            sem limite
          </button>
          {DURATION_CHIPS.map((d) => {
            const active = durationDays === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDurationDays(d)}
                className={
                  "rounded-full px-3.5 py-1.5 text-[14px] tnum transition-all " +
                  (active
                    ? "bg-ink text-paper"
                    : "border border-edge-2 text-ink-soft hover:border-ink-soft hover:text-ink")
                }
              >
                {d}d
              </button>
            );
          })}
          <span className="mx-1 text-ink-faint">ou</span>
          <input
            type="number"
            min={1}
            max={365}
            value={customDuration ? (durationDays as number) : ""}
            onChange={(e) =>
              setDurationDays(e.target.value === "" ? "none" : Number(e.target.value))
            }
            placeholder="outro"
            className="w-20 rounded-full border border-edge-2 bg-transparent px-3 py-1.5 text-center text-[14px] tnum text-ink outline-none placeholder:text-ink-faint/60 focus:border-ink"
          />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-[12px] uppercase tracking-[0.16em] text-ink-faint">
          Começou em
        </label>
        <div className="flex items-baseline gap-4">
          <input
            type="date"
            value={startDate}
            max={todayDate()}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-transparent pb-2 text-[16px] tnum text-ink outline-none focus:border-ink"
            style={{ borderBottom: "1px solid var(--color-edge-2)" }}
          />
          {startDate ? (
            <button
              type="button"
              onClick={() => setStartDate("")}
              className="text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
            >
              limpar
            </button>
          ) : (
            <span className="text-[13px] text-ink-faint">vazio = hoje</span>
          )}
        </div>
      </div>

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
        ) : (
          <span className="text-[13px] text-ink-faint">
            os horários são gerados a partir da primeira hora
          </span>
        )}
      </div>
    </form>
  );
}
