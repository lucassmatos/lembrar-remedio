"use client";

import { useEffect, useState } from "react";
import type { FeedSide, NapActivity } from "@/lib/types";
import { clock, formatDuration, nextSide, SIDE_LABEL } from "@/lib/activity";
import { logFeed, startNap, stopNap } from "@/lib/api";

export function DiaryActions({
  profileId,
  tz,
  openNap,
  lastFeedSide,
}: {
  profileId: string;
  tz: string;
  openNap: NapActivity | null;
  lastFeedSide?: FeedSide;
}) {
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Tick para o cronômetro da soneca em andamento.
  useEffect(() => {
    if (!openNap) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [openNap]);

  const suggested = nextSide(lastFeedSide);

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch {
      // erros de rede são silenciosos aqui; o estado recarrega via onChange
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-10 grid gap-4">
      {/* Soneca */}
      <section
        className="rounded-2xl border border-edge p-5"
        style={{ background: "var(--color-paper-2)" }}
      >
        <p className="mb-3 text-[12px] uppercase tracking-[0.16em] text-ink-faint">soneca</p>
        {openNap ? (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div
                className="flex items-center gap-2 font-display text-[22px] tracking-tight text-ink"
                style={{ animation: "ring-pulse 2.4s ease-in-out infinite", borderRadius: 12 }}
              >
                <span aria-hidden>😴</span> dormindo
              </div>
              <div className="mt-1 text-[13px] text-ink-soft tnum">
                desde {clock(openNap.startedAt, tz)} · {formatDuration(now - openNap.startedAt)}
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => stopNap(openNap))}
              className="shrink-0 rounded-full bg-ink px-6 py-3 text-[15px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
            >
              Terminar
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => startNap(profileId))}
            className="w-full rounded-full bg-ink px-6 py-4 text-[16px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
          >
            Começar soneca
          </button>
        )}
      </section>

      {/* Amamentação */}
      <section
        className="rounded-2xl border border-edge p-5"
        style={{ background: "var(--color-paper-2)" }}
      >
        <p className="mb-3 text-[12px] uppercase tracking-[0.16em] text-ink-faint">amamentação</p>
        <div className="grid grid-cols-2 gap-3">
          {(["left", "right"] as FeedSide[]).map((side) => {
            const isSuggested = side === suggested;
            return (
              <button
                key={side}
                type="button"
                disabled={busy}
                onClick={() => run(() => logFeed(profileId, side))}
                className={
                  "rounded-2xl px-4 py-5 text-[16px] font-medium capitalize transition-all disabled:opacity-50 " +
                  (isSuggested ? "text-paper" : "text-ink hover:border-ink")
                }
                style={
                  isSuggested
                    ? { background: "var(--color-ink)" }
                    : { border: "1px solid var(--color-edge-2)" }
                }
              >
                {SIDE_LABEL[side]}
                {isSuggested ? (
                  <span className="mt-0.5 block text-[11px] font-normal opacity-80">sugerido</span>
                ) : (
                  <span className="mt-0.5 block text-[11px] font-normal text-ink-faint">&nbsp;</span>
                )}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
