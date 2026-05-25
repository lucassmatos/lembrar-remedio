"use client";

import { useEffect, useState } from "react";
import {
  currentPushState,
  disablePush,
  enablePush,
  isIosBrowserNotInstalled,
  type PushState,
} from "@/lib/push-client";

export function PushOptIn() {
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [iosHint, setIosHint] = useState(false);

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
