"use client";

import { useState } from "react";
import type { ProfileWithAccess } from "@/lib/api";
import { addProfile } from "@/lib/api";
import { profileFill, firstName } from "@/lib/profile-ui";

type Props = {
  profiles: ProfileWithAccess[];
  selected: string | "all";
  onSelect: (id: string | "all") => void;
  allowAll?: boolean;
};

// Filter options for the quiet group filter.
// Named "tudo/meus/da casa" (not "todos") to avoid collision with the
// allowAll "todos pessoas" chip that represents the "all profiles" selection.
type GroupFilter = "tudo" | "meus" | "da casa";

export function ProfileBar({ profiles, selected, onSelect, allowAll = false }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Group filter — only rendered when both mine and shared are non-empty
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("tudo");

  async function create(e: React.SyntheticEvent) {
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

  const mine = profiles.filter((p) => (p.accessRole ?? "owner") === "owner");
  const shared = profiles.filter((p) => (p.accessRole ?? "owner") !== "owner");

  // A partner relationship makes the roster one shared household: both members
  // should see the same flat list (no meus/casa split) and both can add people.
  // Detected either way: I'm someone's partner, or a partner is on one of my
  // own profiles. Caregiver shares (role "caregiver") keep the grouped layout.
  const hasPartner =
    profiles.some((p) => p.accessRole === "partner") ||
    mine.some((p) => (p.sharedWith ?? []).some((e) => e.role === "partner"));

  const addPersonButton = !adding ? (
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
  );

  // ── Case A: flat layout — no shared profiles, OR a unified partner household ──
  // (a partner household shows every profile in one list, identical for both members)
  if (shared.length === 0 || hasPartner) {
    // In a partner household both members must see the same order, so sort by
    // creation time (stable across users) instead of "my profiles first".
    const flat = hasPartner
      ? [...profiles].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      : profiles;
    return (
      <div className="mb-8">
        <p className="mb-3 text-[12px] uppercase tracking-[0.16em] text-ink-faint">pessoas</p>
        <div className="grid grid-cols-3 gap-2">
          {allowAll ? (
            <Chip
              active={selected === "all"}
              onClick={() => onSelect("all")}
              label="todos"
            />
          ) : null}
          {flat.map((p) => (
            <Chip
              key={p.id}
              active={selected === p.id}
              color={profileFill(p.color)}
              onClick={() => onSelect(p.id)}
              label={firstName(p.name)}
            />
          ))}
        </div>
        <div className="mt-2">{addPersonButton}</div>
        {err ? (
          <p className="mt-2 text-[13px]" style={{ color: "var(--color-clay)" }}>
            {err}
          </p>
        ) : null}
      </div>
    );
  }

  // ── Case B: has shared profiles — grouped layout ──

  // Whether to show the quiet filter: only when both groups are non-empty
  const showFilter = mine.length > 0 && shared.length > 0;

  // Which groups to render based on active filter
  const showMine = showFilter ? groupFilter === "tudo" || groupFilter === "meus" : mine.length > 0;
  const showShared = showFilter ? groupFilter === "tudo" || groupFilter === "da casa" : true;

  // Label for the caregiver-only case (no owned profiles)
  const sharedGroupLabel = mine.length === 0 ? "cuidando" : "da casa";

  return (
    <div className="mb-8">
      <p className="mb-3 text-[12px] uppercase tracking-[0.16em] text-ink-faint">pessoas</p>

      {/* Quiet filter — only when both groups non-empty */}
      {showFilter ? (
        <div className="mb-4 inline-flex gap-0.5" role="group" aria-label="filtrar pessoas">
          {(["tudo", "meus", "da casa"] as GroupFilter[]).map((opt) => {
            const count = opt === "tudo" ? profiles.length : opt === "meus" ? mine.length : shared.length;
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={groupFilter === opt}
                onClick={() => setGroupFilter(opt)}
                className={
                  "rounded-full px-[11px] py-1 text-[13px] tracking-[0.02em] transition-colors " +
                  (groupFilter === opt
                    ? "text-ink"
                    : "text-ink-faint hover:text-ink")
                }
                style={
                  groupFilter === opt
                    ? {
                        background: "var(--color-paper-2)",
                        boxShadow: "inset 0 0 0 1px var(--color-edge-2)",
                      }
                    : {}
                }
              >
                {opt}{" "}
                <span className="text-ink-faint tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* allowAll "todos pessoas" chip — stays at the very top, before groups */}
      {allowAll ? (
        <div className="mb-3 grid grid-cols-3 gap-2">
          <Chip
            active={selected === "all"}
            onClick={() => onSelect("all")}
            label="todos"
          />
        </div>
      ) : null}

      {/* meus group */}
      {showMine && mine.length > 0 ? (
        <div className={showShared ? "mb-5" : ""}>
          {/* Group label only shown in grouped mode */}
          <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-ink-faint">meus</p>
          <div className="grid grid-cols-3 gap-2">
            {mine.map((p) => (
              <Chip
                key={p.id}
                active={selected === p.id}
                color={profileFill(p.color)}
                onClick={() => onSelect(p.id)}
                label={p.name}
              />
            ))}
          </div>
          {/* add-person form lives in the meus group (creates an owned profile) */}
          <div className="mt-2">{addPersonButton}</div>
        </div>
      ) : null}

      {/* da casa / cuidando group */}
      {showShared ? (
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-ink-faint">
            {sharedGroupLabel}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {shared.map((p) => (
              <Chip
                key={p.id}
                active={selected === p.id}
                color={profileFill(p.color)}
                onClick={() => onSelect(p.id)}
                label={p.name}
              />
            ))}
          </div>
          {/* caregiver with no owned profiles: add-person creates their first owned profile */}
          {mine.length === 0 ? <div className="mt-2">{addPersonButton}</div> : null}
        </div>
      ) : null}

      {/* When meus filter is active and shared group is hidden, still show add-person if not already shown */}
      {showFilter && groupFilter === "meus" && mine.length === 0 ? (
        <div className="flex flex-wrap items-center gap-2">{addPersonButton}</div>
      ) : null}

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
        "flex w-full items-center gap-2 rounded-full px-3.5 py-1.5 text-[14px] transition-all " +
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
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ background: color }}
        />
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
