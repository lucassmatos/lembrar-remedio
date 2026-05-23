"use client";

import { useEffect, useState } from "react";
import { Shell } from "../_components/shell";
import { loadConfig, saveConfig } from "@/lib/storage";

export default function SettingsPage() {
  const [mounted, setMounted] = useState(false);
  const [tz, setTz] = useState("America/Sao_Paulo");
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [installState, setInstallState] = useState<"installed" | "browser" | "unknown">("unknown");

  useEffect(() => {
    const cfg = loadConfig();
    setTz(cfg.timezone);
    if ("Notification" in window) setPerm(Notification.permission);
    else setPerm("unsupported");
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error - iOS Safari
      window.navigator.standalone === true;
    setInstallState(standalone ? "installed" : "browser");
    setMounted(true);
  }, []);

  function saveTz() {
    saveConfig({ ...loadConfig(), timezone: tz });
  }

  async function ask() {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setPerm(p);
  }

  function test() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification("Funcionando", { body: "É assim que o lembrete vai chegar.", icon: "/icon.svg" });
  }

  function clearAll() {
    if (!confirm("Apaga TODOS os remédios, histórico e configurações?")) return;
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
          <Section label="notificações">
            <div className="flex items-baseline justify-between">
              <p className="font-display text-[22px] leading-tight tracking-tight">
                {perm === "granted" ? (
                  <span style={{ color: "var(--color-sage)" }}>liberadas</span>
                ) : perm === "denied" ? (
                  <span style={{ color: "var(--color-clay)" }}>bloqueadas</span>
                ) : perm === "unsupported" ? (
                  <span className="text-ink-soft">não suportadas</span>
                ) : (
                  <span className="text-ink">não pedidas</span>
                )}
              </p>
              <div className="flex gap-4 text-[13px]">
                {perm === "default" ? (
                  <button onClick={ask} className="underline decoration-edge-2 underline-offset-4 hover:text-ink">
                    pedir permissão
                  </button>
                ) : null}
                {perm === "granted" ? (
                  <button onClick={test} className="underline decoration-edge-2 underline-offset-4 hover:text-ink">
                    enviar teste
                  </button>
                ) : null}
              </div>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">
              O navegador só dispara lembrete enquanto o app estiver aberto na
              aba ou rodando como PWA instalado. Pra garantir, mantenha o ícone
              instalado e abra de manhã.
            </p>
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
                className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:opacity-90"
              >
                salvar
              </button>
            </div>
            <p className="mt-3 text-[13px] text-ink-faint">
              detectado: <span className="tnum">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
            </p>
          </Section>

          <Section label="zona de risco">
            <button
              onClick={clearAll}
              className="text-[13px] underline decoration-edge-2 underline-offset-4 hover:text-clay"
            >
              apagar todos os dados
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
