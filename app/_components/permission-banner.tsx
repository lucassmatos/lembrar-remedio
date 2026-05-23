"use client";

import { useEffect, useState } from "react";

export function PermissionBanner() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported" | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setPerm("unsupported");
      return;
    }
    setPerm(Notification.permission);
    setDismissed(sessionStorage.getItem("lr.banner.dismissed") === "1");
  }, []);

  if (perm === null) return null;
  if (perm === "granted") return null;
  if (dismissed) return null;

  if (perm === "unsupported") {
    return (
      <Banner tone="clay">
        Este navegador não tem API de notificações. Você ainda consegue usar o
        app, mas não vou conseguir te avisar.
      </Banner>
    );
  }

  async function ask() {
    const p = await Notification.requestPermission();
    setPerm(p);
  }

  if (perm === "denied") {
    return (
      <Banner tone="clay">
        As notificações estão <b>bloqueadas</b>. Abra as permissões do site no
        navegador e libere pra eu poder te lembrar.{" "}
        <button
          onClick={() => {
            sessionStorage.setItem("lr.banner.dismissed", "1");
            setDismissed(true);
          }}
          className="ml-1 underline decoration-edge-2 underline-offset-4 hover:opacity-80"
        >
          ok, depois
        </button>
      </Banner>
    );
  }

  return (
    <Banner tone="amber">
      Pra eu te avisar na hora certa, preciso da permissão de notificação.{" "}
      <button onClick={ask} className="ml-1 font-medium text-ink underline decoration-edge-2 underline-offset-4">
        liberar
      </button>
      <button
        onClick={() => {
          sessionStorage.setItem("lr.banner.dismissed", "1");
          setDismissed(true);
        }}
        className="ml-3 text-ink-faint underline decoration-edge-2 underline-offset-4"
      >
        agora não
      </button>
    </Banner>
  );
}

function Banner({ tone, children }: { tone: "amber" | "clay"; children: React.ReactNode }) {
  const bg = tone === "amber" ? "var(--color-amber-soft)" : "var(--color-clay-soft)";
  return (
    <div
      className="mb-8 rounded-xl px-4 py-3 text-[13.5px] leading-relaxed text-ink-soft"
      style={{ background: `color-mix(in oklab, ${bg} 70%, transparent)`, border: "1px solid var(--color-edge-2)" }}
    >
      {children}
    </div>
  );
}
