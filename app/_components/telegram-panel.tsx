"use client";

import { useEffect, useRef, useState } from "react";
import { getConfig, setConfig } from "@/lib/api";

type Mode = "loading" | "unpaired" | "pairing" | "paired";

export function TelegramPanel() {
  const [mode, setMode] = useState<Mode>("loading");
  const [chatId, setChatId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = await getConfig();
        if (!alive) return;
        if (cfg.chatId) {
          setChatId(cfg.chatId);
          setMode("paired");
        } else {
          setMode("unpaired");
        }
      } catch {
        if (alive) setMode("unpaired");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    async function poll() {
      if (modeRef.current !== "pairing") return;
      try {
        const cfg = await getConfig();
        if (cfg.chatId) {
          setChatId(cfg.chatId);
          setMode("paired");
        }
      } catch {
        // ignore
      }
    }
    const id = window.setInterval(poll, 3000);
    function onVisible() {
      if (document.visibilityState === "visible") poll();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  async function disconnect() {
    if (!confirm("Desconectar o Telegram?")) return;
    try {
      await setConfig({ chatId: undefined });
      setChatId(null);
      setMode("unpaired");
    } catch {
      setErr("erro ao desconectar");
    }
  }

  if (mode === "loading") {
    return <p className="font-display text-[22px] leading-tight tracking-tight text-ink-soft">…</p>;
  }

  if (mode === "paired" && chatId !== null) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-display text-[22px] leading-tight tracking-tight">
            <span style={{ color: "var(--color-sage)" }}>conectado</span>{" "}
            <span className="tnum text-ink-faint">#{chatId}</span>
          </p>
          <button
            type="button"
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

  if (mode === "pairing") {
    return (
      <div>
        <p className="font-display text-[22px] leading-tight tracking-tight text-ink">
          <span
            className="pulse-amber mr-3 inline-block size-2.5 -translate-y-[3px] rounded-full"
            style={{ background: "var(--color-amber)" }}
          />
          esperando o Telegram
        </p>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
          Toque em <b>Start</b> na conversa que abriu. Quando voltar aqui, a
          página atualiza sozinha.
        </p>
        <div className="mt-4 flex items-center gap-4 text-[13px]">
          <a
            href="/api/telegram/pair-redirect"
            target="_blank"
            rel="noreferrer"
            className="text-ink-soft underline decoration-edge-2 underline-offset-4 hover:text-ink"
          >
            abrir de novo
          </a>
          <button
            type="button"
            onClick={() => setMode("unpaired")}
            className="text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
          >
            cancelar
          </button>
        </div>
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
        leva 10 segundos: toca abaixo, abre no Telegram, toca em Start.
      </p>
      <a
        href="/api/telegram/pair-redirect"
        target="_blank"
        rel="noreferrer"
        onClick={() => setMode("pairing")}
        className="mt-4 inline-block rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium tracking-tight text-paper transition-opacity hover:opacity-90"
      >
        Conectar Telegram
      </a>
      {err ? (
        <p className="mt-3 text-[13px]" style={{ color: "var(--color-clay)" }}>
          {err}
        </p>
      ) : null}
    </div>
  );
}
