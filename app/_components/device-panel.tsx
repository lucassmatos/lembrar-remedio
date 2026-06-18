"use client";

import { useEffect, useState } from "react";
import { getDeviceToken, createDeviceToken } from "@/lib/api";

// Painel de Ajustes pra parear o mostrador físico (e-paper). Gera/rotaciona o
// token que o device usa pra autenticar em /api/device/*.
export function DevicePanel() {
  const [token, setToken] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setBaseUrl(window.location.origin);
    (async () => {
      try {
        const r = await getDeviceToken();
        setToken(r.deviceToken);
      } catch {
        // ignore
      }
      setLoading(false);
    })();
  }, []);

  async function generate() {
    if (token && !confirm("Gerar um token novo invalida o atual — o mostrador vai precisar ser reconfigurado. Continuar?")) {
      return;
    }
    setBusy(true);
    try {
      const r = await createDeviceToken();
      setToken(r.deviceToken);
      setReveal(true);
    } finally {
      setBusy(false);
    }
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  }

  if (loading) return null;

  return (
    <div>
      <p className="font-display text-[22px] leading-tight tracking-tight text-ink">
        {token ? (
          <span style={{ color: "var(--color-sage)" }}>mostrador pareado</span>
        ) : (
          "conectar um mostrador"
        )}
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-faint">
        Um aparelho de tinta eletrônica que mostra a timeline. Gere um token e cole
        no <code className="tnum">config.h</code> do device, junto com o endereço abaixo.
      </p>

      {token ? (
        <div className="mt-4 space-y-3">
          <Field
            label="DEVICE_BASE_URL"
            value={baseUrl}
            onCopy={() => copy("url", baseUrl)}
            copied={copied === "url"}
          />
          <Field
            label="DEVICE_TOKEN"
            value={reveal ? token : "•".repeat(24)}
            onCopy={() => copy("token", token)}
            copied={copied === "token"}
            extra={
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                className="text-[12px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
              >
                {reveal ? "ocultar" : "mostrar"}
              </button>
            }
          />
        </div>
      ) : null}

      <button
        onClick={generate}
        disabled={busy}
        className="mt-4 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "gerando" : token ? "gerar token novo" : "gerar token"}
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onCopy,
  copied,
  extra,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <span className="text-[11px] uppercase tracking-[0.16em] text-ink-faint">{label}</span>
        {extra}
        <button
          type="button"
          onClick={onCopy}
          className="ml-auto text-[12px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
        >
          {copied ? "copiado!" : "copiar"}
        </button>
      </div>
      <div
        className="overflow-x-auto whitespace-nowrap rounded-lg px-3 py-2 text-[13px] tnum text-ink"
        style={{ background: "var(--color-paper-2)", border: "1px solid var(--color-edge-2)" }}
      >
        {value}
      </div>
    </div>
  );
}
