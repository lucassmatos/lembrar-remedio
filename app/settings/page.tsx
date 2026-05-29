"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Shell } from "../_components/shell";
import { TelegramPanel } from "../_components/telegram-panel";
import { PushOptIn } from "../_components/push-opt-in";
import { NotifyProfilesPanel } from "../_components/notify-profiles-panel";
import { ProfilesPanel } from "../_components/profiles-panel";
import { SharingPanel } from "../_components/sharing-panel";
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
  const [startScreen, setStartScreen] = useState<"timeline" | "diario">("timeline");
  const [installState, setInstallState] = useState<"installed" | "browser" | "unknown">("unknown");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState(DEFAULT_OPENAI_MODEL);
  const [showKey, setShowKey] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getConfig();
        setTz(cfg.timezone);
        setStartScreen(cfg.startScreen ?? "timeline");
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

  async function chooseStartScreen(value: "timeline" | "diario") {
    setStartScreen(value);
    if (typeof window !== "undefined") sessionStorage.removeItem("lr.startedDiario");
    try {
      await apiSetConfig({ startScreen: value });
    } catch {
      // ignore
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
    if (!confirm("Apaga a chave da OpenAI deste navegador (não mexe nos medicamentos salvos)?")) return;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("lr.")) localStorage.removeItem(k);
    }
    location.reload();
  }

  function exportData() {
    window.location.href = "/api/user/export";
  }

  async function deleteAccount() {
    setDeleteError("");
    setDeleteBusy(true);
    try {
      const res = await fetch("/api/user", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `falhou (${res.status})`);
      }
      // Limpa localStorage também (BYOK key) e sai.
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith("lr.")) localStorage.removeItem(k);
      }
      await signOut({ callbackUrl: "/login" });
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "erro");
      setDeleteBusy(false);
    }
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

          <Section label="compartilhar">
            <SharingPanel />
          </Section>

          <Section label="notificações no app">
            <PushOptIn />
          </Section>

          <Section label="de quem você recebe">
            <NotifyProfilesPanel />
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
                  em “Adicionar à Tela de Início”.
                </p>
                <p>
                  <b>Android (Chrome):</b> menu de três pontos, “Instalar app”
                  ou “Adicionar à tela inicial”.
                </p>
                <p>
                  <b>Desktop:</b> clique no ícone de instalar na barra de
                  endereço.
                </p>
              </div>
            ) : null}
          </Section>

          <Section label="tela inicial">
            <div className="flex flex-wrap gap-2">
              {([
                { value: "timeline", label: "Timeline" },
                { value: "diario", label: "Diário" },
              ] as const).map((o) => {
                const active = startScreen === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => chooseStartScreen(o.value)}
                    className={
                      "rounded-full px-4 py-2 text-[14px] transition-all " +
                      (active
                        ? "bg-ink text-paper"
                        : "border border-edge-2 text-ink-soft hover:border-ink-soft hover:text-ink")
                    }
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[13px] text-ink-faint">
              {startScreen === "diario"
                ? "O app abre direto no Diário, com o bebê selecionado."
                : "O app abre na Timeline."}
            </p>
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

          <Section label="seus dados">
            <button
              onClick={exportData}
              className="text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
            >
              baixar tudo em JSON
            </button>
            <p className="mt-2 text-[12px] text-ink-faint">
              perfis, medicamentos, vacinas, retornos e adesão dos últimos 60 dias.
            </p>
          </Section>

          <Section label="zona de risco">
            <div className="space-y-5">
              <div>
                <button
                  onClick={clearLocal}
                  className="text-[13px] underline decoration-edge-2 underline-offset-4 hover:text-clay"
                >
                  limpar dados deste navegador
                </button>
                <p className="mt-1 text-[12px] text-ink-faint">
                  apaga só a chave da OpenAI desse aparelho. não mexe nos
                  medicamentos salvos.
                </p>
              </div>

              <div>
                <p className="font-display text-[18px] leading-tight tracking-tight text-clay">
                  apagar minha conta
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
                  apaga todos os perfis, medicamentos, vacinas, retornos, adesão,
                  e desvincula o Telegram. <b>não tem volta.</b> digite{" "}
                  <code className="tnum">APAGAR</code> pra liberar o botão.
                </p>
                <div className="mt-3 flex items-end gap-3">
                  <input
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="APAGAR"
                    autoComplete="off"
                    spellCheck={false}
                    className="flex-1 bg-transparent pb-2 text-[14px] tnum text-ink outline-none placeholder:text-ink-faint/60"
                    style={{ borderBottom: "1px solid var(--color-edge-2)" }}
                  />
                  <button
                    onClick={deleteAccount}
                    disabled={deleteConfirm !== "APAGAR" || deleteBusy}
                    className="rounded-full bg-clay px-4 py-2 text-[13px] font-medium text-paper hover:opacity-90 disabled:opacity-30"
                  >
                    {deleteBusy ? "apagando" : "apagar"}
                  </button>
                </div>
                {deleteError ? (
                  <p className="mt-2 text-[12px] text-clay">{deleteError}</p>
                ) : null}
              </div>
            </div>
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
