"use client";

import { useEffect, useRef, useState } from "react";
import { loadOpenAIKey, loadOpenAIModel } from "@/lib/storage";
import { addMed } from "@/lib/api";
import { analyzePrescription, fileToDataUrl, type ParsedMed } from "@/lib/openai";

type Status = "idle" | "loading" | "review" | "done" | "error";

export function PrescriptionScan() {
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parsed, setParsed] = useState<ParsedMed[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function refresh() {
      setHasKey(loadOpenAIKey().length > 0);
    }
    refresh();
    window.addEventListener("lr:change", refresh);
    return () => window.removeEventListener("lr:change", refresh);
  }, []);

  if (!hasKey) return null;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr(null);
    setWarnings([]);
    setParsed([]);
    setSelected({});
    setStatus("loading");
    try {
      const dataUrl = await fileToDataUrl(file);
      setPreview(dataUrl);
      const result = await analyzePrescription(
        loadOpenAIKey(),
        dataUrl,
        loadOpenAIModel(),
      );
      if (result.medications.length === 0) {
        setStatus("error");
        setErr("Não consegui identificar remédios nessa foto.");
        if (result.warnings?.length) setWarnings(result.warnings);
        return;
      }
      setParsed(result.medications);
      setSelected(Object.fromEntries(result.medications.map((_, i) => [i, true])));
      setWarnings(result.warnings ?? []);
      setStatus("review");
    } catch (e) {
      setStatus("error");
      setErr(e instanceof Error ? e.message : "Erro inesperado.");
    }
  }

  function updateParsed(i: number, patch: Partial<ParsedMed>) {
    setParsed((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  function updateTime(medIdx: number, timeIdx: number, value: string) {
    setParsed((prev) =>
      prev.map((m, idx) => {
        if (idx !== medIdx) return m;
        const times = m.times.map((t, j) => (j === timeIdx ? value : t));
        return { ...m, times, startTime: times[0] ?? m.startTime };
      }),
    );
  }

  function removeTime(medIdx: number, timeIdx: number) {
    setParsed((prev) =>
      prev.map((m, idx) => {
        if (idx !== medIdx) return m;
        if (m.times.length <= 1) return m;
        const times = m.times.filter((_, j) => j !== timeIdx);
        return { ...m, times, startTime: times[0] };
      }),
    );
  }

  function addTime(medIdx: number) {
    setParsed((prev) =>
      prev.map((m, idx) => {
        if (idx !== medIdx) return m;
        const next = nextSuggestedTime(m.times);
        const times = [...m.times, next];
        return { ...m, times, startTime: times[0] };
      }),
    );
  }

  async function confirm() {
    const chosen = parsed.filter((_, i) => selected[i]);
    if (chosen.length === 0) return;
    setStatus("loading");
    try {
      for (const p of chosen) {
        const sorted = [...p.times].filter((t) => /^\d{2}:\d{2}$/.test(t)).sort();
        const times = sorted.length > 0 ? Array.from(new Set(sorted)) : [p.startTime];
        await addMed({
          name: p.name,
          dosage: p.dosage,
          intervalHours: p.intervalHours,
          startTime: times[0],
          times: times.length > 1 ? times : undefined,
        });
      }
      setStatus("done");
      window.setTimeout(reset, 1400);
    } catch (e) {
      setStatus("error");
      setErr(e instanceof Error ? e.message : "Não consegui salvar.");
    }
  }

  function reset() {
    setStatus("idle");
    setParsed([]);
    setSelected({});
    setPreview(null);
    setWarnings([]);
    setErr(null);
  }

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <section className="mb-14">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="font-display text-[18px] tracking-tight text-ink-soft">
          Escanear receita
        </h2>
        <span className="text-[11px] uppercase tracking-[0.16em] text-ink-faint">
          com ia
        </span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFile}
        className="hidden"
      />

      {status === "idle" ? (
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium tracking-tight text-paper transition-opacity hover:opacity-90"
          >
            tirar foto
          </button>
          <p className="text-[13px] leading-relaxed text-ink-faint">
            A IA lê nome, dose e horários — você revisa antes de salvar.
          </p>
        </div>
      ) : null}

      {status === "loading" ? (
        <div className="enter flex items-center gap-3 py-2 text-[14px] text-ink-soft">
          <span
            className="pulse-amber inline-block size-2.5 rounded-full"
            style={{ background: "var(--color-amber)" }}
          />
          analisando a receita
        </div>
      ) : null}

      {status === "error" ? (
        <div className="enter space-y-3">
          <p className="text-[14px]" style={{ color: "var(--color-clay)" }}>
            {err}
          </p>
          {warnings.length > 0 ? (
            <ul className="space-y-1 text-[13px] text-ink-faint">
              {warnings.map((w, i) => (
                <li key={i}>· {w}</li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="text-[13px] underline decoration-edge-2 underline-offset-4 hover:text-ink"
          >
            tentar de novo
          </button>
        </div>
      ) : null}

      {status === "done" ? (
        <p className="enter text-[14px]" style={{ color: "var(--color-sage)" }}>
          remédios adicionados.
        </p>
      ) : null}

      {status === "review" ? (
        <div className="enter">
          <div className="flex items-center gap-4 pb-5">
            {preview ? (
              <img
                src={preview}
                alt="receita"
                className="size-14 rounded-lg object-cover"
                style={{ border: "1px solid var(--color-edge)" }}
              />
            ) : null}
            <p className="text-[13px] leading-relaxed text-ink-soft">
              {parsed.length === 1
                ? "1 remédio detectado. Ajuste o que precisar antes de salvar."
                : `${parsed.length} remédios detectados. Ajuste o que precisar antes de salvar.`}
            </p>
          </div>

          {warnings.length > 0 ? (
            <ul
              className="mb-3 space-y-1 text-[13px]"
              style={{ color: "var(--color-clay)" }}
            >
              {warnings.map((w, i) => (
                <li key={i}>· {w}</li>
              ))}
            </ul>
          ) : null}

          <ul className="divide-y divide-edge">
            {parsed.map((m, i) => {
              const isSelected = !!selected[i];
              return (
                <li key={i} className="py-6">
                  <div className="flex items-start gap-4">
                    <button
                      type="button"
                      onClick={() => setSelected((s) => ({ ...s, [i]: !s[i] }))}
                      aria-pressed={isSelected}
                      aria-label={isSelected ? "remover da seleção" : "incluir na seleção"}
                      className="mt-1.5 shrink-0"
                    >
                      <Tick selected={isSelected} />
                    </button>
                    <div
                      className={
                        "min-w-0 flex-1 space-y-5 transition-opacity " +
                        (isSelected ? "" : "opacity-50")
                      }
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <input
                          value={m.name}
                          onChange={(e) => updateParsed(i, { name: e.target.value })}
                          className="min-w-0 flex-1 bg-transparent pb-1 font-display text-[20px] leading-tight tracking-tight text-ink outline-none focus:border-ink"
                          style={{ borderBottom: "1px solid var(--color-edge-2)" }}
                        />
                        {m.confidence ? <ConfidenceTag value={m.confidence} /> : null}
                      </div>

                      <Field label="Dose">
                        <input
                          value={m.dosage ?? ""}
                          onChange={(e) =>
                            updateParsed(i, { dosage: e.target.value || undefined })
                          }
                          placeholder="—"
                          className="w-full bg-transparent pb-1 text-[14px] text-ink outline-none placeholder:text-ink-faint/60 focus:border-ink"
                          style={{ borderBottom: "1px solid var(--color-edge-2)" }}
                        />
                      </Field>

                      <Field label="Horários">
                        <div className="flex flex-wrap items-center gap-2">
                          {m.times.map((t, j) => (
                            <span
                              key={j}
                              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] tnum"
                              style={{ border: "1px solid var(--color-edge-2)" }}
                            >
                              <input
                                type="time"
                                value={t}
                                onChange={(e) => updateTime(i, j, e.target.value)}
                                className="w-[68px] bg-transparent text-center text-ink outline-none"
                              />
                              {m.times.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={() => removeTime(i, j)}
                                  aria-label={`remover ${t}`}
                                  className="text-ink-faint hover:text-clay"
                                >
                                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                                    <path
                                      d="M1.5 1.5l7 7M8.5 1.5l-7 7"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                </button>
                              ) : null}
                            </span>
                          ))}
                          <button
                            type="button"
                            onClick={() => addTime(i)}
                            className="rounded-full px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
                            style={{ border: "1px dashed var(--color-edge-2)" }}
                          >
                            + horário
                          </button>
                        </div>
                      </Field>

                      {m.notes ? (
                        <p className="text-[13px] leading-relaxed text-ink-soft">
                          <span className="text-ink-faint">da receita: </span>
                          “{m.notes}”
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center gap-5 pt-6">
            <button
              type="button"
              onClick={confirm}
              disabled={selectedCount === 0}
              className="rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium tracking-tight text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {selectedCount <= 1 ? "adicionar" : `adicionar ${selectedCount}`}
            </button>
            <button
              type="button"
              onClick={reset}
              className="text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
            >
              cancelar
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-[11px] uppercase tracking-[0.16em] text-ink-faint">
        {label}
      </span>
      {children}
    </div>
  );
}

function Tick({ selected }: { selected: boolean }) {
  if (selected) {
    return (
      <span
        className="grid size-5 place-items-center rounded-full transition-colors"
        style={{ background: "var(--color-sage-soft)", color: "var(--color-sage)" }}
      >
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M2.5 7.5L5.5 10.5L11.5 4"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="block size-5 rounded-full transition-colors hover:[box-shadow:inset_0_0_0_1px_var(--color-ink-faint)]"
      style={{ boxShadow: "inset 0 0 0 1px var(--color-edge-2)" }}
    />
  );
}

function ConfidenceTag({ value }: { value: "high" | "medium" | "low" }) {
  const label = value === "high" ? "certo" : value === "medium" ? "inferido" : "incerto";
  const color =
    value === "high"
      ? "var(--color-sage)"
      : value === "medium"
        ? "var(--color-ink-faint)"
        : "var(--color-clay)";
  return (
    <span
      className="shrink-0 text-[10px] uppercase tracking-[0.18em]"
      style={{ color }}
    >
      {label}
    </span>
  );
}

function nextSuggestedTime(times: string[]): string {
  if (times.length === 0) return "08:00";
  const last = times[times.length - 1];
  const m = last.match(/^(\d{2}):(\d{2})$/);
  if (!m) return "08:00";
  const total = (Number(m[1]) * 60 + Number(m[2]) + 4 * 60) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
