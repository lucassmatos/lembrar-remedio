"use client";

import { useEffect, useState } from "react";
import {
  currentPushState,
  disablePush,
  enablePush,
  isIosBrowserNotInstalled,
  type PushState,
} from "@/lib/push-client";
import { sendTestNotification } from "@/lib/api";

export function PushOptIn() {
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  async function test() {
    setTestMsg("enviando…");
    try {
      const r = await sendTestNotification("push");
      setTestMsg(
        r.push === "sent"
          ? "enviado ✓ — trava a tela e veja chegar"
          : r.push === "no-device"
            ? "nenhum aparelho ativado"
            : "falhou",
      );
    } catch {
      setTestMsg("erro ao enviar");
    }
  }

  useEffect(() => {
    setIosHint(isIosBrowserNotInstalled());
    currentPushState()
      .then(setState)
      .catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    await enablePush();
    setState(await currentPushState());
    setBusy(false);
  }

  async function disable() {
    setBusy(true);
    await disablePush();
    setState(await currentPushState());
    setBusy(false);
  }

  if (state === "loading") return null;

  return (
    <div>
      {state === "subscribed" ? (
        <div>
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-display text-[22px] leading-tight tracking-tight">
              <span style={{ color: "var(--color-sage)" }}>ativado neste aparelho</span>
            </p>
            <button
              type="button"
              onClick={disable}
              disabled={busy}
              className="shrink-0 text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-clay disabled:opacity-50"
            >
              desativar
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={test}
              className="rounded-full px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
              style={{ border: "1px solid var(--color-edge-2)" }}
            >
              enviar teste
            </button>
            {testMsg ? <span className="text-[13px] text-ink-faint">{testMsg}</span> : null}
          </div>
        </div>
      ) : state === "denied" ? (
        <p className="text-[14px] leading-relaxed text-ink-soft">
          Notificações bloqueadas. Libere nas configurações do navegador/sistema
          pra este site e tente de novo.
        </p>
      ) : state === "unsupported" ? (
        <p className="text-[14px] leading-relaxed text-ink-soft">
          Este aparelho/navegador não suporta notificações no app. Use o Telegram
          {iosHint ? ", ou adicione o app à Tela de Início pra liberar push no iPhone" : ""}.
        </p>
      ) : (
        <div>
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium tracking-tight text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "ativando" : "ativar notificações neste aparelho"}
          </button>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">
            Recebe os lembretes de dose direto no aparelho, junto com o Telegram.
          </p>
        </div>
      )}

      {iosHint && state !== "subscribed" ? (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">
          <b>iPhone:</b> primeiro toque em compartilhar e "Adicionar à Tela de
          Início". Depois abra o app pela tela inicial e ative aqui (o iOS só
          permite push em apps instalados).
        </p>
      ) : null}
    </div>
  );
}
