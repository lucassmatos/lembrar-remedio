"use client";

import { useState } from "react";
import type { Activity, FeedActivity, NapActivity, Profile } from "@/lib/types";
import { feedMethod, isNap } from "@/lib/types";
import {
  activityTime,
  buildSummary,
  clock,
  FEED_NOUN,
  feedDetail,
  formatDuration,
  nextSide,
} from "@/lib/activity";
import { epochFromLocal } from "@/lib/schedule";
import { deleteActivity, updateActivity } from "@/lib/api";
import { profileFill } from "@/lib/profile-ui";
import { Baby, Droplet, Milk, Moon, type LucideIcon } from "lucide-react";

const FEED_ICON: Record<"breast" | "bottle" | "pump", LucideIcon> = {
  breast: Baby,
  bottle: Milk,
  pump: Droplet,
};

function NapIcon({ color }: { color?: string }) {
  return (
    <Moon
      size={16}
      strokeWidth={1.75}
      aria-hidden
      style={{ color: color ?? "var(--color-sage)" }}
    />
  );
}

function FeedIcon({ feed, color }: { feed: FeedActivity; color?: string }) {
  const Icon = FEED_ICON[feedMethod(feed)] ?? Baby;
  return (
    <Icon
      size={16}
      strokeWidth={1.75}
      aria-hidden
      style={{ color: color ?? "var(--color-amber)" }}
    />
  );
}

export function ActivityList({
  activities,
  tz,
  profileById,
}: {
  activities: Activity[];
  tz: string;
  profileById?: Map<string, Profile>;
}) {
  function rowColor(a: Activity): string | undefined {
    const p = profileById?.get(a.profileId);
    return p ? profileFill(p.color) : undefined;
  }
  const [editing, setEditing] = useState<string | null>(null);

  if (activities.length === 0) {
    return (
      <p className="py-6 text-[15px] text-ink-soft">Nada registrado nesse dia.</p>
    );
  }

  const rows = [...activities].sort((a, b) => activityTime(a) - activityTime(b));
  const summary = buildSummary(activities);

  async function remove(a: Activity) {
    if (!confirm("Apagar esse registro?")) return;
    await deleteActivity(a.id, a.date);
  }

  return (
    <section>
      <p className="mb-2 text-[13px] text-ink-soft">{summary}</p>
      <ul className="divide-y divide-edge">
        {rows.map((a) => (
          <li key={a.id} className="py-4">
            {isNap(a) ? (
              editing === a.id ? (
                <NapEditor
                  nap={a}
                  tz={tz}
                  color={rowColor(a)}
                  onCancel={() => setEditing(null)}
                  onSaved={() => setEditing(null)}
                />
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <NapIcon color={rowColor(a)} />
                      <span className="font-display text-[18px] tracking-tight text-ink">
                        Soneca
                      </span>
                    </div>
                    <div className="mt-1 pl-[18px] text-[13px] text-ink-soft tnum">
                      {a.endedAt == null
                        ? `desde ${clock(a.startedAt, tz)} · em andamento`
                        : `${clock(a.startedAt, tz)}–${clock(a.endedAt, tz)} · ${formatDuration(a.endedAt - a.startedAt)}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-[13px]">
                    <button
                      type="button"
                      onClick={() => setEditing(a.id)}
                      className="text-ink-soft underline decoration-edge-2 underline-offset-4 transition-colors hover:text-ink"
                    >
                      editar
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(a)}
                      className="text-ink-faint underline decoration-edge-2 underline-offset-4 transition-colors hover:text-clay"
                    >
                      apagar
                    </button>
                  </div>
                </div>
              )
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <FeedIcon feed={a} color={rowColor(a)} />
                    <span className="font-display text-[18px] tracking-tight text-ink">
                      {FEED_NOUN[feedMethod(a)]}
                      {feedDetail(a) ? (
                        <span className="text-ink-soft"> · {feedDetail(a)}</span>
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-1 pl-[18px] text-[13px] text-ink-soft tnum">{clock(a.at, tz)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-[13px]">
                  {a.side ? (
                    <button
                      type="button"
                      onClick={() => updateActivity(a.id, { date: a.date, side: nextSide(a.side) })}
                      className="text-ink-soft underline decoration-edge-2 underline-offset-4 transition-colors hover:text-ink"
                    >
                      trocar lado
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => remove(a)}
                    className="text-ink-faint underline decoration-edge-2 underline-offset-4 transition-colors hover:text-clay"
                  >
                    apagar
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function NapEditor({
  nap,
  tz,
  color,
  onCancel,
  onSaved,
}: {
  nap: NapActivity;
  tz: string;
  color?: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [start, setStart] = useState(() => clock(nap.startedAt, tz));
  const [end, setEnd] = useState(() => (nap.endedAt != null ? clock(nap.endedAt, tz) : ""));
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const startedAt = epochFromLocal(nap.date, start, tz);
      const patch: { date: string; startedAt: number; endedAt?: number } = {
        date: nap.date,
        startedAt,
      };
      if (nap.endedAt != null && end) {
        patch.endedAt = epochFromLocal(nap.date, end, tz);
      }
      await updateActivity(nap.id, patch);
      onSaved();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2.5">
        <NapIcon color={color} />
        <span className="font-display text-[18px] tracking-tight text-ink">Soneca</span>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-[12px] uppercase tracking-[0.16em] text-ink-faint">
          início
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="tnum mt-1 block rounded-lg px-3 py-2 text-[16px] text-ink"
            style={{ border: "1px solid var(--color-edge-2)", background: "var(--color-paper)" }}
          />
        </label>
        {nap.endedAt != null ? (
          <label className="text-[12px] uppercase tracking-[0.16em] text-ink-faint">
            fim
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="tnum mt-1 block rounded-lg px-3 py-2 text-[16px] text-ink"
              style={{ border: "1px solid var(--color-edge-2)", background: "var(--color-paper)" }}
            />
          </label>
        ) : null}
      </div>
      <div className="flex items-center gap-3 text-[14px]">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="rounded-full bg-ink px-5 py-2 font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          Salvar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-ink-soft underline decoration-edge-2 underline-offset-4 hover:text-ink"
        >
          cancelar
        </button>
      </div>
    </div>
  );
}
