"use client";

import { useEffect, useState } from "react";
import {
  getConfig,
  getProfiles,
  setConfig,
  onChange,
  type ProfileWithAccess,
} from "@/lib/api";
import { initialNotifyProfileIds } from "@/lib/notify-prefs";
import { profileFill } from "@/lib/profile-ui";

function isOwner(p: ProfileWithAccess): boolean {
  return (p.accessRole ?? "owner") === "owner";
}

export function NotifyProfilesPanel() {
  const [profiles, setProfiles] = useState<ProfileWithAccess[]>([]);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [cfg, profs] = await Promise.all([getConfig(), getProfiles()]);
        if (cancelled) return;
        setProfiles(profs);
        const init = initialNotifyProfileIds(
          cfg.notifyProfileIds,
          profs.map((p) => ({ id: p.id, isOwner: isOwner(p) })),
        );
        setSelected(new Set(init));
        setLoaded(true);
      } catch {
        // ignore — settings page já mostra os outros painéis
      }
    }
    refresh();
    // Reage a perfis criados/removidos/compartilhados em outra aba/componente.
    const off = onChange("profiles", refresh);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  async function toggle(id: string) {
    if (!selected) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Atualização otimista — reverte no erro.
    const prev = selected;
    setSelected(next);
    setErr(null);
    try {
      await setConfig({ notifyProfileIds: Array.from(next) });
    } catch {
      setSelected(prev);
      setErr("não consegui salvar, tenta de novo");
    }
  }

  if (!loaded || !selected) return null;

  if (profiles.length === 0) {
    return <p className="text-[14px] text-ink-soft">nenhuma pessoa ainda.</p>;
  }

  return (
    <div>
      <p className="mb-3 text-[13px] leading-relaxed text-ink-faint">
        Escolha de quem você quer receber os lembretes (Telegram e app). Por
        padrão, só das suas próprias pessoas.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {profiles.map((p) => {
          const active = selected.has(p.id);
          const color = profileFill(p.color);
          return (
            <button
              key={p.id}
              type="button"
              role="switch"
              aria-checked={active}
              onClick={() => toggle(p.id)}
              className={
                "flex w-full items-center gap-2 rounded-full px-3.5 py-2 text-[14px] transition-all " +
                (active ? "text-paper" : "text-ink-soft hover:text-ink")
              }
              style={
                active
                  ? { background: color }
                  : { border: "1px solid var(--color-edge-2)" }
              }
            >
              <span
                aria-hidden
                className="inline-block size-2 shrink-0 rounded-full"
                style={{ background: active ? "var(--color-paper)" : color }}
              />
              <span className="min-w-0 truncate">{p.name}</span>
            </button>
          );
        })}
      </div>
      {err ? (
        <p className="mt-2 text-[13px]" style={{ color: "var(--color-clay)" }}>
          {err}
        </p>
      ) : null}
    </div>
  );
}
