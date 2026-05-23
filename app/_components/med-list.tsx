"use client";

import { useEffect, useState } from "react";
import type { Medication, Profile } from "@/lib/types";
import {
  daysBetween,
  formatBrDate,
  generateSlotsForMed,
  medWindow,
  nowInTz,
} from "@/lib/schedule";
import { deleteMed, getConfig } from "@/lib/api";
import { MedForm } from "./med-form";
import { ProfileBadge } from "./profile-badge";

export function MedList({
  meds,
  profiles = [],
}: {
  meds: Medication[];
  profiles?: Profile[];
}) {
  const [tz, setTz] = useState("America/Sao_Paulo");
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const showProfile = profiles.length >= 2;
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  if (meds.length === 0) {
    return (
      <p className="py-6 text-[15px] text-ink-soft">
        Você ainda não cadastrou nenhum remédio.
      </p>
    );
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Apagar ${name}?`)) return;
    await deleteMed(id);
    if (editingId === id) setEditingId(null);
  }

  return (
    <ul className="divide-y divide-edge">
      {meds.map((med) => {
        const isEditing = editingId === med.id;
        const times = generateSlotsForMed(med);
        const window = med.durationDays ? medWindow(med, tz) : null;
        const today = nowInTz(tz).date;
        const durationLabel = renderDurationLabel(med, window, today);
        return (
          <li key={med.id} className="py-5">
            {isEditing ? (
              <div className="rounded-2xl border border-edge bg-paper-2/40 p-5">
                <MedForm
                  med={med}
                  onSaved={() => setEditingId(null)}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-display text-[20px] leading-tight tracking-tight text-ink">
                    {showProfile && profileById.get(med.profileId) ? (
                      <ProfileBadge profile={profileById.get(med.profileId)!} size={20} />
                    ) : null}
                    <span className="min-w-0 truncate">{med.name}</span>
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
                  {durationLabel ? (
                    <div className="mt-2 text-[12px]" style={{ color: durationLabel.color }}>
                      {durationLabel.text}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-4 text-[13px]">
                  <button
                    type="button"
                    onClick={() => setEditingId(med.id)}
                    className="text-ink-soft underline decoration-edge-2 underline-offset-4 transition-colors hover:text-ink"
                  >
                    editar
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(med.id, med.name)}
                    className="text-ink-faint underline decoration-edge-2 underline-offset-4 transition-colors hover:text-clay"
                  >
                    apagar
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function renderDurationLabel(
  _med: Medication,
  window: { startDate: string; endDate: string | null } | null,
  today: string,
): { text: string; color: string } | null {
  if (!window || !window.endDate) return null;
  const { startDate, endDate } = window;
  if (today < startDate) {
    const days = Math.max(1, daysBetween(today, startDate));
    return {
      text: `começa em ${formatBrDate(startDate)} · daqui ${days} ${days === 1 ? "dia" : "dias"}`,
      color: "var(--color-ink-faint)",
    };
  }
  if (today > endDate) {
    return {
      text: `tratamento terminou em ${formatBrDate(endDate)}`,
      color: "var(--color-ink-faint)",
    };
  }
  const remaining = daysBetween(today, endDate);
  if (remaining === 0) {
    return {
      text: `último dia · termina hoje`,
      color: "var(--color-clay)",
    };
  }
  return {
    text: `faltam ${remaining} ${remaining === 1 ? "dia" : "dias"} · termina ${formatBrDate(endDate)}`,
    color: remaining <= 2 ? "var(--color-clay)" : "var(--color-ink-faint)",
  };
}
