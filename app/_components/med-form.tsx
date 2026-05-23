"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import { loadMeds, saveMeds } from "@/lib/storage";
import type { Medication } from "@/lib/types";

const INTERVAL_CHIPS = [4, 6, 8, 12, 24];

export function MedForm({ onAdded }: { onAdded?: (m: Medication) => void }) {
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [intervalHours, setIntervalHours] = useState<number | "">(8);
  const [startTime, setStartTime] = useState("08:00");
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr("Dá um nome pro remédio.");
    if (!intervalHours || Number(intervalHours) <= 0) return setErr("Intervalo precisa ser maior que zero.");
    const med: Medication = {
      id: nanoid(8),
      name: name.trim(),
      dosage: dosage.trim() || undefined,
      intervalHours: Number(intervalHours),
      startTime,
      createdAt: Date.now(),
    };
    const meds = loadMeds();
    meds.push(med);
    saveMeds(meds);
    setName("");
    setDosage("");
    setIntervalHours(8);
    setStartTime("08:00");
    onAdded?.(med);
  }

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

      {err ? (
        <p className="text-[14px]" style={{ color: "var(--color-clay)" }}>
          {err}
        </p>
      ) : null}

      <div className="flex items-center gap-4 pt-2">
        <button
          type="submit"
          className="rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium tracking-tight text-paper transition-opacity hover:opacity-90"
        >
          Adicionar
        </button>
        <span className="text-[13px] text-ink-faint">
          os horários são gerados a partir da primeira hora
        </span>
      </div>
    </form>
  );
}
