"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  token: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
};

export function AcceptForm({ token, payload }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isPartner = payload.mode === "partner";
  const profileCount: number = Array.isArray(payload.profileIds)
    ? payload.profileIds.length
    : 0;

  async function accept() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/sharing/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `erro ${res.status}`);
      }
      router.push("/?bemvindo=1");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "erro ao aceitar convite");
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      <div
        className="rounded-2xl p-5"
        style={{
          background: "var(--color-paper-2)",
          border: "1px solid var(--color-edge-2)",
        }}
      >
        <p className="text-[15px] leading-relaxed text-ink-soft">
          {isPartner
            ? "Vocês vão compartilhar todos os perfis um do outro."
            : `Você terá acesso de cuidador a ${profileCount} perfil${profileCount !== 1 ? "s" : ""}.`}
        </p>
      </div>

      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="w-full rounded-full bg-ink px-5 py-3.5 text-[15px] font-medium tracking-tight text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "aceitando..." : "aceitar convite"}
      </button>

      {err ? (
        <p className="text-[13px]" style={{ color: "var(--color-clay)" }}>
          {err}
        </p>
      ) : null}

      <p className="text-[12.5px] leading-relaxed text-ink-faint">
        Ao aceitar, você confirma que reconhece quem enviou este convite.
      </p>
    </div>
  );
}
