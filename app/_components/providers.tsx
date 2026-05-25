"use client";

import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { registerServiceWorker } from "@/lib/push-client";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return <SessionProvider>{children}</SessionProvider>;
}
