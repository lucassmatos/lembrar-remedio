"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Shell } from "../_components/shell";
import { TelegramPanel } from "../_components/telegram-panel";
import { ProfilesPanel } from "../_components/profiles-panel";
import { getConfig, setConfig as apiSetConfig } from "@/lib/api";
import {
  DEFAULT_OPENAI_MODEL,
  loadOpenAIKey,
  loadOpenAIModel,
  saveOpenAIKey,
  saveOpenAIModel,
} from "@/lib/storage";

export default function SettingsPage() {
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  const [tz, setTz] = useState("America/Sao_Paulo");
  const [tzBusy, setTzBusy] = useState(false);
  const [installState, setInstallState] = useState<"installed" | "browser" | "unknown">("unknown");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState(DEFAULT_OPENAI_MODEL);
  const [showKey, setShowKey] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getConfig();
        setTz(cfg.timezone);
      } catch {
        // ignore
      }
      setOpenaiKey(loadOpenAIKey());
      setOpenaiModel(loadOpenAIModel());
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // @ts-expect-error - iOS Safari
        window.navigator.standalone === true;
      setInstallState(standalone ? "installed" : "browser");
      setMounted(true);
    })();
  }, []);

  async function saveTz() {
    setTzBusy(true);
    try {
      await apiSetConfig({ timezone: tz });
    } finally {
      setTzBusy(false);
    }
  }

  function saveKey() {
    saveOpenAIKey(openaiKey);
    saveOpenAIModel(openaiModel);
  }

  function clearKey() {
    saveOpenAIKey("");
    setOpenaiKey("");
  }

  function clearLocal() {
    if (!confirm("Apaga a chave da OpenAI deste navegador (não mexe nos remédios salvos)?")) return;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("lr.")) localStorage.removeItem(k);
    }
    location.reload();
  }

  return (
    <Shell
      current="ajustes"
      header={
        <section className="mb-10">
          <p className="text-[13px] uppercase tracking-[0.18em] text-ink-faint">
            preferências
          </p>
          <h1 className="mt-1 font-display text-[44px] leading-[1.05] tracking-tight text-ink">
            Ajustes
          </h1>
        </section>
      }
    >
      {!mounted ? null : (
        <div className="space-y-14">
          <Section label="conta">
            <div className="flex items-baseline justify-between gap-4">
              <p className="min-w-0 truncate font-display text-[22px] leading-tight tracking-tight text-ink">
                {session?.user?.email ?? "—"}
              </p>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="shrink-0 text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-clay"
              >
                sair
              </button>
            </div>
          </Section>

          <Section label="pessoas">
            <ProfilesPanel />
          </Section>

          <Section label="telegram">
            <TelegramPanel />
          </Section>

          <Section label="instalar como app">
            <p className="font-display text-[22px] leading-tight tracking-tight text-ink">
              {installState === "installed" ? (
                <span style={{ color: "var(--color-sage)" }}>instalado</span>
              ) : (
                "instalar no celular"
              )}
            </p>
            {installState !== "installed" ? (
              <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-ink-soft">
                <p>
                  <b>iPhone (Safari):</b> toque no botão de compartilhar, depois
                  em "Adicionar à Tela de Início".
                </p>
                <p>
                  <b>Android (Chrome):</b> menu de três pontos, "Instalar app"
                  ou "Adicionar à tela inicial".
                </p>
                <p>
                  <b>Desktop:</b> clique no ícone de instalar na barra de
                  endereço.
                </p>
              </div>
            ) : null}
          </Section>

          <Section label="fuso horário">
            <div className="flex items-end gap-3">
              <input
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                placeholder="America/Sao_Paulo"
                className="flex-1 bg-transparent pb-2 text-[16px] text-ink outline-none placeholder:text-ink-faint/60"
                style={{ borderBottom: "1px solid var(--color-edge-2)" }}
              />
              <button
                onClick={saveTz}
                disabled={tzBusy}
                className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
              >
                {tzBusy ? "salvando" : "salvar"}
              </button>
            </div>
            <p className="mt-3 text-[13px] text-ink-faint">
              detectado: <span className="tnum">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
            </p>
          </Section>

          <Section label="openai (opcional)">
            <p className="font-display text-[22px] leading-tight tracking-tight text-ink">
              {openaiKey ? (
                <span style={{ color: "var(--color-sage)" }}>chave salva</span>
              ) : (
                "escanear receita com IA"
              )}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-faint">
              Cole sua chave da OpenAI pra ativar a leitura de receita por
              foto. A chave fica só neste aparelho e é usada direto contra a
              API da OpenAI.
            </p>
            <div className="mt-4 flex items-end gap-3">
              <input
                type={showKey ? "text" : "password"}
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-..."
                spellCheck={false}
                autoComplete="off"
                className="flex-1 bg-transparent pb-2 text-[16px] tnum text-ink outline-none placeholder:text-ink-faint/60 focus:border-ink"
                style={{ borderBottom: "1px solid var(--color-edge-2)" }}
              />
              <button
                onClick={saveKey}
                className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:opacity-90"
              >
                salvar
              </button>
            </div>
            <div className="mt-3 flex items-center gap-5 text-[13px]">
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
              >
                {showKey ? "ocultar" : "mostrar"}
              </button>
              <button
                type="button"
                onClick={() => setAdvanced((v) => !v)}
                className="text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
              >
                {advanced ? "ocultar avançado" : "avançado"}
              </button>
              {openaiKey ? (
                <button
                  onClick={clearKey}
                  className="ml-auto text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-clay"
                >
                  remover chave
                </button>
              ) : null}
            </div>
            {advanced ? (
              <div className="mt-5 enter">
                <span className="mb-2 block text-[11px] uppercase tracking-[0.16em] text-ink-faint">
                  Modelo
                </span>
                <div className="flex items-end gap-3">
                  <input
                    value={openaiModel}
                    onChange={(e) => setOpenaiModel(e.target.value)}
                    placeholder={DEFAULT_OPENAI_MODEL}
                    spellCheck={false}
                    autoComplete="off"
                    className="flex-1 bg-transparent pb-2 text-[16px] tnum text-ink outline-none placeholder:text-ink-faint/60 focus:border-ink"
                    style={{ borderBottom: "1px solid var(--color-edge-2)" }}
                  />
                  <button
                    onClick={() => saveOpenAIModel(openaiModel)}
                    className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:opacity-90"
                  >
                    salvar
                  </button>
                </div>
                <p className="mt-2 text-[12px] text-ink-faint">
                  padrão: <span className="tnum">{DEFAULT_OPENAI_MODEL}</span> — precisa
                  ser um modelo da OpenAI com visão.
                </p>
              </div>
            ) : null}
          </Section>

          <Section label="zona de risco">
            <button
              onClick={clearLocal}
              className="text-[13px] underline decoration-edge-2 underline-offset-4 hover:text-clay"
            >
              limpar dados deste navegador
            </button>
          </Section>
        </div>
      )}
    </Shell>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-3 text-[12px] uppercase tracking-[0.16em] text-ink-faint">{label}</p>
      {children}
    </section>
  );
}
