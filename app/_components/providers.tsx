"use client";

import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { registerServiceWorker } from "@/lib/push-client";
import { refetchAll } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  // Quando a aba volta ao foco/visível, refaz o fetch de tudo. Sem isso, dado
  // mexido noutro aparelho só aparecia recarregando a página na mão.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") refetchAll();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refetchAll);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refetchAll);
    };
  }, []);

  return <SessionProvider>{children}</SessionProvider>;
}
