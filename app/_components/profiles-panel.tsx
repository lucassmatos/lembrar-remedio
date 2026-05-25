"use client";

import { useEffect, useState } from "react";
import { addProfile, deleteProfile, getProfiles, onChange, updateProfile } from "@/lib/api";
import { PROFILE_COLORS, type Profile, type ProfileColor } from "@/lib/types";
import { profileFill } from "@/lib/profile-ui";
import { ProfileBadge } from "./profile-badge";

export function ProfilesPanel() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<ProfileColor>("sage");
  const [draftAindaMama, setDraftAindaMama] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const next = await getProfiles();
        if (!cancelled) {
          setProfiles(next);
          setLoaded(true);
        }
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
  }, []);

  function startEdit(p: Profile) {
    setEditingId(p.id);
    setDraftName(p.name);
    setDraftColor(p.color);
    setDraftAindaMama(!!p.aindaMama);
    setErr(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    setBusy(true);
    setErr(null);
    try {
      await updateProfile(editingId, {
        name: draftName.trim(),
        color: draftColor,
        aindaMama: draftAindaMama,
      });
      setEditingId(null);
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return setErr("dá um nome");
    setBusy(true);
    setErr(null);
    try {
      await addProfile(newName.trim());
      setNewName("");
      setAdding(false);
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Profile) {
    if (p.isDefault) return;
    if (profiles.length <= 1) return;
    if (!confirm(`Apagar ${p.name} e TODOS os medicamentos dela?`)) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteProfile(p.id);
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="space-y-5">
      <ul className="divide-y divide-edge">
        {profiles.map((p) => {
          const isEditing = editingId === p.id;
          return (
            <li key={p.id} className="py-4">
              {isEditing ? (
                <div className="space-y-3">
                  <input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    maxLength={40}
                    autoFocus
                    className="w-full bg-transparent pb-1 font-display text-[20px] leading-tight tracking-tight text-ink outline-none focus:border-ink"
                    style={{ borderBottom: "1px solid var(--color-edge-2)" }}
                  />
                  <div className="flex flex-wrap gap-2">
                    {PROFILE_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setDraftColor(c)}
                        aria-label={c}
                        className="inline-grid size-7 place-items-center rounded-full transition-transform"
                        style={{
                          background: profileFill(c),
                          outline:
                            draftColor === c
                              ? "2px solid var(--color-ink)"
                              : "1px solid var(--color-edge-2)",
                          outlineOffset: draftColor === c ? "2px" : "0",
                        }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draftAindaMama}
                    onClick={() => setDraftAindaMama((v) => !v)}
                    className="flex items-center gap-2.5 text-[14px] text-ink-soft hover:text-ink"
                  >
                    <span
                      aria-hidden
                      className="grid size-5 place-items-center rounded-md text-[12px] text-paper transition-colors"
                      style={{
                        background: draftAindaMama ? "var(--color-ink)" : "transparent",
                        border: draftAindaMama
                          ? "1px solid var(--color-ink)"
                          : "1px solid var(--color-edge-2)",
                      }}
                    >
                      {draftAindaMama ? "✓" : ""}
                    </span>
                    bebê que ainda mama
                    <span className="text-ink-faint">· mostra a mamada no diário</span>
                  </button>
                  <div className="flex items-center gap-4 pt-1">
                    <button
                      type="button"
                      onClick={saveEdit}
                      disabled={busy}
                      className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
                    >
                      {busy ? "salvando" : "salvar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
                    >
                      cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <ProfileBadge profile={p} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[18px] leading-tight tracking-tight text-ink">
                      {p.name}
                      {p.isDefault ? (
                        <span className="ml-2 text-[11px] uppercase tracking-[0.16em] text-ink-faint">
                          padrão
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-[13px]">
                    <button
                      type="button"
                      onClick={() => startEdit(p)}
                      className="text-ink-soft underline decoration-edge-2 underline-offset-4 hover:text-ink"
                    >
                      editar
                    </button>
                    {!p.isDefault && profiles.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => remove(p)}
                        className="text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-clay"
                      >
                        apagar
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {adding ? (
        <form onSubmit={create} className="flex items-center gap-3">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="nome (ex: Vovô)"
            maxLength={40}
            className="flex-1 bg-transparent pb-2 text-[16px] text-ink outline-none placeholder:text-ink-faint/60 focus:border-ink"
            style={{ borderBottom: "1px solid var(--color-edge-2)" }}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "criando" : "criar"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewName("");
              setErr(null);
            }}
            className="text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
          >
            cancelar
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-[13px] underline decoration-edge-2 underline-offset-4 hover:text-ink"
        >
          + adicionar pessoa
        </button>
      )}

      {err ? (
        <p className="text-[13px]" style={{ color: "var(--color-clay)" }}>
          {err}
        </p>
      ) : null}
    </div>
  );
}

function humanError(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^API \d+:\s*/, "");
  return "erro";
}
