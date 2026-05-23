"use client";

import type { Medication } from "@/lib/types";
import { generateSlotsForMed } from "@/lib/schedule";
import { loadMeds, saveMeds } from "@/lib/storage";

export function MedList({ meds }: { meds: Medication[] }) {
  if (meds.length === 0) {
    return (
      <p className="py-6 text-[15px] text-ink-soft">
        Você ainda não cadastrou nenhum remédio.
      </p>
    );
  }

  function remove(id: string, name: string) {
    if (!confirm(`Apagar ${name}?`)) return;
    const next = loadMeds().filter((m) => m.id !== id);
    saveMeds(next);
  }

  return (
    <ul className="divide-y divide-edge">
      {meds.map((med) => {
        const times = generateSlotsForMed(med);
        return (
          <li key={med.id} className="flex items-start justify-between gap-4 py-5">
            <div className="min-w-0 flex-1">
              <div className="font-display text-[20px] leading-tight tracking-tight text-ink">
                {med.name}
              </div>
              <div className="mt-1 text-[13px] text-ink-soft">
                {med.dosage ? `${med.dosage} · ` : ""}
                a cada {med.intervalHours}h
              </div>
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[13px] tnum text-ink-faint">
                {times.map((t, i) => (
                  <span key={t + i}>
                    {t}
                    {i < times.length - 1 ? <span className="ml-2 text-ink-faint/50">·</span> : null}
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => remove(med.id, med.name)}
              className="shrink-0 text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 transition-colors hover:text-clay"
            >
              apagar
            </button>
          </li>
        );
      })}
    </ul>
  );
}
