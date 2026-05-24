"use client";

import { useEffect, useRef, useState } from "react";
import {
  getSharing,
  createInvite,
  removeShare,
  getProfiles,
  onChange,
  type SharingData,
  type InviteResult,
} from "@/lib/api";
import type { Profile } from "@/lib/types";

// ── helpers ────────────────────────────────────────────────────────────────────

function humanError(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^API \d+:\s*/, "");
  return "erro";
}

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

// ── InviteLinkBlock ────────────────────────────────────────────────────────────

function InviteLinkBlock({ result }: { result: InviteResult }) {
  const [copied, setCopied] = useState(false);
  const fullUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${result.url}`
      : result.url;

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the input
    }
  }

  async function share() {
    try {
      await navigator.share({ url: fullUrl, title: "convite lembrar-remédio" });
    } catch {
      // user cancelled or not supported
    }
  }

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div
      className="mt-4 rounded-2xl p-4 space-y-3 enter"
      style={{ background: "var(--color-amber-soft, oklch(0.96 0.04 75))", border: "1px solid var(--color-edge-2)" }}
    >
      <p className="text-[11px] uppercase tracking-[0.16em] text-ink-faint">link de convite</p>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={fullUrl}
          className="min-w-0 flex-1 bg-transparent pb-1 tnum text-[13px] text-ink-soft outline-none select-all"
          style={{ borderBottom: "1px solid var(--color-edge-2)" }}
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={copy}
          className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:opacity-90"
        >
          {copied ? "copiado" : "copiar"}
        </button>
        {canShare ? (
          <button
            type="button"
            onClick={share}
            className="text-[13px] text-ink-soft underline decoration-edge-2 underline-offset-4 hover:text-ink"
          >
            compartilhar
          </button>
        ) : null}
      </div>
      <p className="text-[12px] text-ink-faint">válido por 24h. quem abrir vai precisar ter uma conta.</p>
    </div>
  );
}

// ── CaregiverInviteForm ────────────────────────────────────────────────────────

function CaregiverInviteForm({
  ownProfiles,
  onDone,
}: {
  ownProfiles: Profile[];
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);

  function toggleProfile(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const canSubmit = selected.size > 0 && isValidEmail(email) && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await createInvite({
        mode: "caregiver",
        profileIds: Array.from(selected),
        inviteeEmail: email.trim(),
      });
      setResult(res);
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div>
        <InviteLinkBlock result={result} />
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setSelected(new Set());
            setEmail("");
            onDone();
          }}
          className="mt-3 text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
        >
          fechar
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4 enter">
      {ownProfiles.length === 0 ? (
        <p className="text-[13px] text-ink-faint">
          você precisa ter pelo menos um perfil próprio para convidar cuidadores.
        </p>
      ) : (
        <>
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-ink-faint">perfis a compartilhar</p>
            <div className="flex flex-wrap gap-2">
              {ownProfiles.map((p) => {
                const active = selected.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProfile(p.id)}
                    className={
                      "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] transition-all " +
                      (active ? "text-paper" : "text-ink-soft hover:text-ink")
                    }
                    style={
                      active
                        ? { background: "var(--color-ink)" }
                        : { border: "1px solid var(--color-edge-2)" }
                    }
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-ink-faint">email do cuidador</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@exemplo.com"
              autoComplete="email"
              className="w-full bg-transparent pb-2 text-[16px] text-ink outline-none placeholder:text-ink-faint/60"
              style={{ borderBottom: "1px solid var(--color-edge-2)" }}
            />
          </div>
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "gerando" : "gerar link"}
            </button>
            <button
              type="button"
              onClick={onDone}
              className="text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
            >
              cancelar
            </button>
          </div>
          {err ? (
            <p className="text-[13px]" style={{ color: "var(--color-clay)" }}>
              {err}
            </p>
          ) : null}
        </>
      )}
    </form>
  );
}

// ── SharingPanel ───────────────────────────────────────────────────────────────

export function SharingPanel() {
  const [data, setData] = useState<SharingData | null>(null);
  const [ownProfiles, setOwnProfiles] = useState<Profile[]>([]);
  const [partnerInvite, setPartnerInvite] = useState<InviteResult | null>(null);
  const [partnerEmail, setPartnerEmail] = useState("");
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [partnerErr, setPartnerErr] = useState<string | null>(null);
  const [showCaregiverForm, setShowCaregiverForm] = useState(false);
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  const removeBusyRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const [sharing, profiles] = await Promise.all([
          getSharing(),
          getProfiles(),
        ]);
        if (cancelled) return;
        setData(sharing);
        // Filter accessRole === "owner" — profiles API returns Profile[] but
        // GET /api/profiles also returns accessRole in each item.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setOwnProfiles(profiles.filter((p: any) => !p.accessRole || p.accessRole === "owner"));
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

  async function generatePartnerInvite() {
    if (!isValidEmail(partnerEmail)) return;
    setPartnerBusy(true);
    setPartnerErr(null);
    try {
      const res = await createInvite({
        mode: "partner",
        inviteeEmail: partnerEmail.trim(),
      });
      setPartnerInvite(res);
    } catch (e) {
      setPartnerErr(humanError(e));
    } finally {
      setPartnerBusy(false);
    }
  }

  async function removePartner() {
    if (!confirm("Remover o vínculo com seu parceiro(a)? Ambos perdem acesso aos perfis compartilhados.")) return;
    setRemoveErr(null);
    try {
      await removeShare({ kind: "partner" });
      setData((d) => d ? { ...d, partner: null } : d);
    } catch (e) {
      setRemoveErr(humanError(e));
    }
  }

  async function removeCaregiver(profileId: string, sub: string) {
    const key = `${profileId}:${sub}`;
    if (removeBusyRef.current.has(key)) return;
    removeBusyRef.current.add(key);
    setRemoveErr(null);
    try {
      await removeShare({ kind: "caregiver", profileId, memberSub: sub });
      setData((d) =>
        d
          ? {
              ...d,
              caregivers: d.caregivers.filter(
                (c) => !(c.profileId === profileId && c.sub === sub),
              ),
            }
          : d,
      );
    } catch (e) {
      setRemoveErr(humanError(e));
    } finally {
      removeBusyRef.current.delete(key);
    }
  }

  async function leaveProfile(ownerSub: string, profileId: string) {
    if (!confirm("Sair deste perfil compartilhado? Você perderá o acesso.")) return;
    setRemoveErr(null);
    try {
      await removeShare({ kind: "leave", ownerSub, profileId });
      setData((d) =>
        d
          ? {
              ...d,
              memberOf: d.memberOf.filter(
                (m) => !(m.ownerSub === ownerSub && m.profileId === profileId),
              ),
            }
          : d,
      );
    } catch (e) {
      setRemoveErr(humanError(e));
    }
  }

  if (!data) {
    return (
      <p className="font-display text-[22px] leading-tight tracking-tight text-ink-soft">
        …
      </p>
    );
  }

  const { partner, caregivers, memberOf } = data;

  return (
    <div className="space-y-8">
      {/* parceiro(a) */}
      <div>
        <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-ink-faint">parceiro(a)</p>
        {partner ? (
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-display text-[20px] leading-tight tracking-tight text-ink">
              {partner.partnerName ?? partner.partnerEmail ?? "vinculado"}
            </p>
            <button
              type="button"
              onClick={removePartner}
              className="shrink-0 text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-clay"
            >
              remover
            </button>
          </div>
        ) : partnerInvite ? (
          <div>
            <p className="text-[14px] text-ink-soft">
              convite gerado. compartilhe com seu parceiro(a):
            </p>
            <InviteLinkBlock result={partnerInvite} />
            <button
              type="button"
              onClick={() => {
                setPartnerInvite(null);
                setPartnerEmail("");
              }}
              className="mt-3 text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-ink"
            >
              fechar
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              parceiros compartilham todos os perfis um do outro automaticamente.
            </p>
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-ink-faint">email do parceiro(a)</p>
              <input
                type="email"
                value={partnerEmail}
                onChange={(e) => setPartnerEmail(e.target.value)}
                placeholder="email@exemplo.com"
                autoComplete="email"
                className="w-full bg-transparent pb-2 text-[16px] text-ink outline-none placeholder:text-ink-faint/60"
                style={{ borderBottom: "1px solid var(--color-edge-2)" }}
              />
            </div>
            <button
              type="button"
              onClick={generatePartnerInvite}
              disabled={partnerBusy || !isValidEmail(partnerEmail)}
              className="rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium tracking-tight text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {partnerBusy ? "gerando" : "convidar parceiro(a)"}
            </button>
            {partnerErr ? (
              <p className="mt-2 text-[13px]" style={{ color: "var(--color-clay)" }}>
                {partnerErr}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* cuidadores */}
      <div>
        <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-ink-faint">cuidadores</p>
        {caregivers.length > 0 ? (
          <ul className="divide-y divide-edge mb-4">
            {caregivers.map((c) => (
              <li
                key={`${c.profileId}:${c.sub}`}
                className="flex items-baseline justify-between gap-4 py-3"
              >
                <span className="text-[15px] text-ink">
                  {c.profileName}
                </span>
                <button
                  type="button"
                  onClick={() => removeCaregiver(c.profileId, c.sub)}
                  className="shrink-0 text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-clay"
                >
                  remover
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-[14px] text-ink-soft">nenhum cuidador ainda.</p>
        )}

        {showCaregiverForm ? (
          <CaregiverInviteForm
            ownProfiles={ownProfiles}
            onDone={() => setShowCaregiverForm(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowCaregiverForm(true)}
            className="text-[13px] underline decoration-edge-2 underline-offset-4 hover:text-ink"
          >
            + adicionar cuidador
          </button>
        )}
      </div>

      {/* você cuida de */}
      {memberOf.length > 0 ? (
        <div>
          <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-ink-faint">você cuida de</p>
          <ul className="divide-y divide-edge">
            {memberOf.map((m) => (
              <li
                key={`${m.ownerSub}:${m.profileId}`}
                className="flex items-baseline justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <span className="text-[15px] text-ink">{m.profileName}</span>
                  <span
                    className="ml-2 text-[11px] uppercase tracking-[0.08em] rounded-full px-2 py-0.5"
                    style={{
                      background: "var(--color-sage-soft, oklch(0.92 0.035 145))",
                      color: "oklch(0.42 0.06 145)",
                    }}
                  >
                    {m.role}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => leaveProfile(m.ownerSub, m.profileId)}
                  className="shrink-0 text-[13px] text-ink-faint underline decoration-edge-2 underline-offset-4 hover:text-clay"
                >
                  sair
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {removeErr ? (
        <p className="text-[13px]" style={{ color: "var(--color-clay)" }}>
          {removeErr}
        </p>
      ) : null}
    </div>
  );
}
