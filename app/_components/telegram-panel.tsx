"use client";

import { useEffect, useRef, useState } from "react";
import { getConfig, setConfig } from "@/lib/api";

type Mode = "loading" | "unpaired" | "pairing" | "paired";

type PairInfo = { url: string; token: string };

export function TelegramPanel() {
  const [mode, setMode] = useState<Mode>("loading");
  const [chatId, setChatId] = useState<number | null>(null);
  const [pair, setPair] = useState<PairInfo | null>(null);
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
    const id = window.setInterval(async () => {
      if (modeRef.current !== "pairing") return;
      try {
        const cfg = await getConfig();
        if (cfg.chatId) {
          setChatId(cfg.chatId);
          setMode("paired");
          setPair(null);
        }
      } catch {
        // ignore
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  async function startPairing() {
    console.log("[lr] startPairing click");
    setErr(null);
    try {
      const res = await fetch("/api/telegram/pair", { method: "POST" });
      console.log("[lr] pair response", res.status);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { url: string; token: string; expiresIn: number };
      console.log("[lr] pair data", data);
      setPair({ url: data.url, token: data.token });
      setMode("pairing");
    } catch (e) {
      console.error("[lr] pair error", e);
      setErr(e instanceof Error ? e.message : "não consegui gerar o link");
    }
  }

  async function disconnect() {
    if (!confirm("Desconectar o Telegram?")) return;
    try {
      await setConfig({ chatId: undefined });
      setChatId(null);
      setPair(null);
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

  if (mode === "pairing" && pair) {
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
          href={pair.url}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium tracking-tight text-paper transition-opacity hover:opacity-90"
        >
          Abrir Telegram
        </a>
        <p className="mt-3 text-[12px] text-ink-faint">link válido por 10 minutos.</p>
        <button
          type="button"
          onClick={() => {
            setPair(null);
            setMode("unpaired");
          }}
          className="mt-3 ml-4 text-[12px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
        >
          cancelar
        </button>
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
        leva 10 segundos: clica abaixo, abre o link no Telegram, toca em Start.
      </p>
      <button
        type="button"
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
