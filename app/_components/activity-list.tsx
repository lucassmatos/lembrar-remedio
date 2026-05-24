"use client";

import type { Activity } from "@/lib/types";
import { isNap } from "@/lib/types";
import { activityTime, buildSummary, clock, formatDuration, nextSide, SIDE_LABEL } from "@/lib/activity";
import { deleteActivity, updateActivity } from "@/lib/api";

export function ActivityList({ activities, tz }: { activities: Activity[]; tz: string }) {
  if (activities.length === 0) {
    return (
      <p className="py-6 text-[15px] text-ink-soft">
        Nada registrado nesse dia ainda. Use os botões acima.
      </p>
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
          <li key={a.id} className="flex items-start justify-between gap-4 py-4">
            <div className="min-w-0 flex-1">
              {isNap(a) ? (
                <>
                  <div className="font-display text-[18px] tracking-tight text-ink">
                    😴 Soneca
                  </div>
                  <div className="mt-1 text-[13px] text-ink-soft tnum">
                    {a.endedAt == null
                      ? `desde ${clock(a.startedAt, tz)} · em andamento`
                      : `${clock(a.startedAt, tz)}–${clock(a.endedAt, tz)} · ${formatDuration(a.endedAt - a.startedAt)}`}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-display text-[18px] tracking-tight text-ink">
                    🤱 Mamada · lado {SIDE_LABEL[a.side]}
                  </div>
                  <div className="mt-1 text-[13px] text-ink-soft tnum">{clock(a.at, tz)}</div>
                </>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-4 text-[13px]">
              {!isNap(a) ? (
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
          </li>
        ))}
      </ul>
    </section>
  );
}
