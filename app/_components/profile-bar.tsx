"use client";

import { useState } from "react";
import type { Profile } from "@/lib/types";
import { addProfile } from "@/lib/api";
import { profileFill } from "@/lib/profile-ui";

type Props = {
  profiles: Profile[];
  selected: string | "all";
  onSelect: (id: string | "all") => void;
  allowAll?: boolean;
};

export function ProfileBar({ profiles, selected, onSelect, allowAll = false }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr("dá um nome");
    setBusy(true);
    try {
      const created = await addProfile(name.trim());
      setName("");
      setAdding(false);
      onSelect(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^API \d+:\s*/, "") : "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-8">
      <p className="mb-3 text-[12px] uppercase tracking-[0.16em] text-ink-faint">pessoas</p>
      <div className="flex flex-wrap items-center gap-2">
        {allowAll ? (
          <Chip
            active={selected === "all"}
            onClick={() => onSelect("all")}
            label="todos"
          />
        ) : null}
        {profiles.map((p) => (
          <Chip
            key={p.id}
            active={selected === p.id}
            color={profileFill(p.color)}
            onClick={() => onSelect(p.id)}
            label={p.name}
          />
        ))}
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-full px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
            style={{ border: "1px dashed var(--color-edge-2)" }}
          >
            + pessoa
          </button>
        ) : (
          <form onSubmit={create} className="flex min-w-[12rem] flex-1 items-center gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="nome"
              maxLength={40}
              className="min-w-0 flex-1 rounded-full bg-transparent px-3.5 py-1.5 text-[14px] text-ink outline-none placeholder:text-ink-faint/60 focus:border-ink"
              style={{ border: "1px solid var(--color-edge-2)" }}
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "..." : "criar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setName("");
                setErr(null);
              }}
              className="text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
            >
              cancelar
            </button>
          </form>
        )}
      </div>
      {err ? (
        <p className="mt-2 text-[13px]" style={{ color: "var(--color-clay)" }}>
          {err}
        </p>
      ) : null}
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[14px] transition-all " +
        (active ? "text-paper" : "text-ink-soft hover:text-ink")
      }
      style={
        active
          ? { background: color ?? "var(--color-ink)" }
          : { border: "1px solid var(--color-edge-2)" }
      }
    >
      {!active && color ? (
        <span
          className="inline-block size-2 rounded-full"
          style={{ background: color }}
        />
      ) : null}
      {label}
    </button>
  );
}
