"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getProfiles, onChange } from "@/lib/api";

export type NavKey = "timeline" | "lembretes" | "diario" | "casa" | "ajustes";

type NavItem = { key: NavKey; label: string; href: string };

// RN entra entre "Dia a dia" e "Ajustes" — só quando a família tem um membro
// marcado como recém-nascido (ver Nav abaixo).
const BEFORE_RN: NavItem[] = [
  { key: "timeline", label: "Timeline", href: "/" },
  { key: "lembretes", label: "Saúde", href: "/lembretes" },
  { key: "casa", label: "Dia a dia", href: "/casa" },
];
const RN_ITEM: NavItem = { key: "diario", label: "RN", href: "/diario" };
const AJUSTES: NavItem = { key: "ajustes", label: "Ajustes", href: "/settings" };

export function Nav({ current }: { current: NavKey }) {
  // O RN (recém-nascido) é um diário de soneca/mamada que só faz sentido com um
  // bebê na família. Aparece quando algum perfil acessível está marcado como RN
  // (flag `aindaMama`). Quando você JÁ está na tela RN, mostra desde o SSR pra
  // aba ativa não sumir durante o fetch.
  const [hasRN, setHasRN] = useState(current === "diario");

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const p = await getProfiles();
        if (!cancelled) setHasRN(current === "diario" || p.some((x) => x.aindaMama));
      } catch {
        // ignore
      }
    }
    refresh();
    const off = onChange("profiles", refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, [current]);

  const items: NavItem[] = [...BEFORE_RN, ...(hasRN ? [RN_ITEM] : []), AJUSTES];

  return (
    <nav className="flex justify-end">
      <div className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1 text-[13px] sm:gap-x-5 sm:text-[14px]">
        {items.map((it) => {
          const active = it.key === current;
          return (
            <Link
              key={it.key}
              href={it.href}
              className={
                "tracking-tight transition-colors " +
                (active ? "text-ink font-medium" : "text-ink-faint hover:text-ink-soft")
              }
            >
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
