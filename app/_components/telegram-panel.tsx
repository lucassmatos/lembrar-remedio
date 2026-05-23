"use client";

import { useEffect, useState } from "react";
import { getConfig, setConfig } from "@/lib/api";

type State =
  | { kind: "loading" }
  | { kind: "unpaired" }
  | { kind: "pairing"; url: string; token: string; expiresAt: number }
  | { kind: "paired"; chatId: number };

export function TelegramPanel() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getConfig();
        if (cancelled) return;
        setState(cfg.chatId ? { kind: "paired", chatId: cfg.chatId } : { kind: "unpaired" });
      } catch {
        if (!cancelled) setState({ kind: "unpaired" });
      }
    })();
    const id = window.setInterval(refresh, 5000);
    async function refresh() {
      if (state.kind !== "pairing") return;
      try {
        const cfg = await getConfig();
        if (cfg.chatId) setState({ kind: "paired", chatId: cfg.chatId });
      } catch {
        // ignore
      }
    }
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [state.kind]);

  async function startPairing() {
    setErr(null);
    try {
      const res = await fetch("/api/telegram/pair", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { url: string; token: string; expiresIn: number };
      setState({
        kind: "pairing",
        url: data.url,
        token: data.token,
        expiresAt: Date.now() + data.expiresIn * 1000,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "não consegui gerar o link");
    }
  }

  async function disconnect() {
    if (!confirm("Desconectar o Telegram?")) return;
    try {
      await setConfig({ chatId: undefined });
      setState({ kind: "unpaired" });
    } catch {
      setErr("erro ao desconectar");
    }
  }

  if (state.kind === "loading") {
    return <p className="font-display text-[22px] leading-tight tracking-tight text-ink-soft">…</p>;
  }

  if (state.kind === "paired") {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-display text-[22px] leading-tight tracking-tight">
            <span style={{ color: "var(--color-sage)" }}>conectado</span>{" "}
            <span className="tnum text-ink-faint">#{state.chatId}</span>
          </p>
          <button
            onClick={disconnect}
            className="text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-clay"
          >
            desconectar
          </button>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-faint">
          Lembretes chegam no Telegram. Toque em "✓ Tomei" ou "Pular" pra
          marcar — sincroniza com o app na hora.
        </p>
      </div>
    );
  }

  if (state.kind === "pairing") {
    return (
      <div>
        <p className="font-display text-[22px] leading-tight tracking-tight text-ink">
          esperando você abrir
        </p>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
          Abra esse link no Telegram, toque em <b>Start</b>. Em alguns segundos
          essa página atualiza sozinha.
        </p>
        <a
          href={state.url}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium tracking-tight text-paper transition-opacity hover:opacity-90"
        >
          Abrir Telegram
        </a>
        <p className="mt-3 text-[12px] text-ink-faint">
          link válido por 10 minutos.
        </p>
        {err ? (
          <p className="mt-3 text-[13px]" style={{ color: "var(--color-clay)" }}>
            {err}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <p className="font-display text-[22px] leading-tight tracking-tight text-ink">
        não conectado
      </p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-faint">
        Sem Telegram, eu não consigo te avisar com o app fechado. Conectar
        leva 10 segundos: clica abaixo, abre o link no Telegram, toca em
        Start.
      </p>
      <button
        onClick={startPairing}
        className="mt-4 rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium tracking-tight text-paper transition-opacity hover:opacity-90"
      >
        Conectar Telegram
      </button>
      {err ? (
        <p className="mt-3 text-[13px]" style={{ color: "var(--color-clay)" }}>
          {err}
        </p>
      ) : null}
    </div>
  );
}
