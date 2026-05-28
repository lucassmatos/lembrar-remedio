"use client";

import { useEffect, useState } from "react";
import type { BottleContent, FeedMethod, FeedSide, NapActivity, ProfileColor } from "@/lib/types";
import { clock, CONTENT_LABEL, formatDuration, nextSide, SIDE_LABEL } from "@/lib/activity";
import { logFeed, startNap, stopNap, type FeedInput } from "@/lib/api";
import { profileFill } from "@/lib/profile-ui";
import { Moon } from "lucide-react";

const ML_PRESETS = [30, 60, 90, 120, 150, 180];

export function DiaryActions({
  profileId,
  tz,
  openNap,
  lastFeedSide,
  aindaMama = false,
  profileColor,
}: {
  profileId: string;
  tz: string;
  openNap: NapActivity | null;
  lastFeedSide?: FeedSide;
  aindaMama?: boolean;
  profileColor?: ProfileColor;
}) {
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [method, setMethod] = useState<FeedMethod>("breast");
  const [amountMl, setAmountMl] = useState(90);
  const [content, setContent] = useState<BottleContent>("formula");
  const [pumpSide, setPumpSide] = useState<FeedSide>("left");

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

  function submitFeed(input: FeedInput) {
    return run(() => logFeed(profileId, input));
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
              <div className="flex items-center gap-2.5 font-display text-[22px] tracking-tight text-ink">
                <Moon
                  size={22}
                  strokeWidth={1.6}
                  aria-hidden
                  style={{ color: profileColor ? profileFill(profileColor) : "var(--color-sage)" }}
                />
                dormindo
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

      {/* Alimentação — só pra bebê que ainda mama */}
      {aindaMama ? (
      <section
        className="rounded-2xl border border-edge p-5"
        style={{ background: "var(--color-paper-2)" }}
      >
        <p className="mb-3 text-[12px] uppercase tracking-[0.16em] text-ink-faint">alimentação</p>

        <div className="mb-4 grid grid-cols-3 gap-1.5 rounded-full p-1" style={{ border: "1px solid var(--color-edge-2)" }}>
          {(["breast", "bottle", "pump"] as FeedMethod[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              aria-pressed={method === m}
              className={
                "rounded-full py-2 text-[14px] font-medium transition-colors " +
                (method === m ? "text-paper" : "text-ink-soft hover:text-ink")
              }
              style={method === m ? { background: "var(--color-ink)" } : undefined}
            >
              {m === "breast" ? "Peito" : m === "bottle" ? "Mamadeira" : "Extração"}
            </button>
          ))}
        </div>

        {method === "breast" ? (
          <div className="grid grid-cols-2 gap-3">
            {(["left", "right"] as FeedSide[]).map((side) => {
              const isSuggested = side === suggested;
              return (
                <button
                  key={side}
                  type="button"
                  disabled={busy}
                  onClick={() => submitFeed({ method: "breast", side })}
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
        ) : (
          <div className="grid gap-4">
            <MlPicker value={amountMl} onChange={setAmountMl} />

            {method === "bottle" ? (
              <Segmented<BottleContent>
                label="conteúdo"
                value={content}
                onChange={setContent}
                options={[
                  { value: "formula", label: CONTENT_LABEL.formula },
                  { value: "breastmilk", label: CONTENT_LABEL.breastmilk },
                ]}
              />
            ) : (
              <Segmented<FeedSide>
                label="lado"
                value={pumpSide}
                onChange={setPumpSide}
                options={[
                  { value: "left", label: SIDE_LABEL.left },
                  { value: "right", label: SIDE_LABEL.right },
                ]}
              />
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() =>
                submitFeed(
                  method === "bottle"
                    ? { method: "bottle", amountMl, content }
                    : { method: "pump", amountMl, side: pumpSide },
                )
              }
              className="w-full rounded-full bg-ink px-6 py-4 text-[16px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
            >
              Registrar {method === "bottle" ? "mamadeira" : "extração"} · {amountMl} ml
            </button>
          </div>
        )}
      </section>
      ) : null}
    </div>
  );
}

function MlPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <p className="mb-2 text-[12px] uppercase tracking-[0.16em] text-ink-faint">volume (ml)</p>
      <div className="flex flex-wrap gap-2">
        {ML_PRESETS.map((ml) => (
          <button
            key={ml}
            type="button"
            onClick={() => onChange(ml)}
            aria-pressed={value === ml}
            className={
              "tnum rounded-full px-4 py-2 text-[15px] font-medium transition-colors " +
              (value === ml ? "text-paper" : "text-ink-soft hover:text-ink")
            }
            style={
              value === ml
                ? { background: "var(--color-ink)" }
                : { border: "1px solid var(--color-edge-2)" }
            }
          >
            {ml}
          </button>
        ))}
        <label className="flex items-center gap-1.5 rounded-full px-3 py-2" style={{ border: "1px solid var(--color-edge-2)" }}>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={2000}
            value={value}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(Math.max(1, Math.min(2000, Math.round(n))));
            }}
            className="tnum w-14 bg-transparent text-[15px] text-ink outline-none"
            aria-label="volume em ml"
          />
          <span className="text-[13px] text-ink-faint">ml</span>
        </label>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div>
      <p className="mb-2 text-[12px] uppercase tracking-[0.16em] text-ink-faint">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={
              "rounded-2xl px-4 py-3.5 text-[15px] font-medium capitalize transition-all " +
              (value === o.value ? "text-paper" : "text-ink hover:border-ink")
            }
            style={
              value === o.value
                ? { background: "var(--color-ink)" }
                : { border: "1px solid var(--color-edge-2)" }
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
