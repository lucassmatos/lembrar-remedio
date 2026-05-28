"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell } from "../_components/shell";
import { MedForm } from "../_components/med-form";
import { MedList } from "../_components/med-list";
import { OneShotForm } from "../_components/one-shot-form";
import { UpcomingList } from "../_components/upcoming-list";
import { PrescriptionScan } from "../_components/prescription-scan";
import { ProfileBar } from "../_components/profile-bar";
import { getProfiles, getReminders, onChange } from "@/lib/api";
import type { ProfileWithAccess } from "@/lib/api";
import type { Reminder, ReminderKind } from "@/lib/types";
import { KIND_META, KIND_ORDER, isReminderKind } from "@/lib/reminder-kinds";
import { Calendar, Pill, Syringe, type LucideIcon } from "lucide-react";

const KIND_ICON: Record<ReminderKind, LucideIcon> = {
  medication: Pill,
  appointment: Calendar,
  vaccine: Syringe,
};

const SELECTED_KEY = "lr.profile.selected.v1";
const KIND_KEY = "lr.lembretes.kind.v1";

function initialKind(): ReminderKind {
  if (typeof window === "undefined") return "medication";
  const fromUrl = new URLSearchParams(window.location.search).get("tipo");
  if (isReminderKind(fromUrl)) return fromUrl;
  const stored = localStorage.getItem(KIND_KEY);
  if (isReminderKind(stored)) return stored;
  return "medication";
}

export default function LembretesPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [profiles, setProfiles] = useState<ProfileWithAccess[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [kind, setKind] = useState<ReminderKind>("medication");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setKind(initialKind());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [r, p] = await Promise.all([getReminders(), getProfiles()]);
        if (cancelled) return;
        setReminders(r);
        setProfiles(p);
        setSelected((cur) => {
          if (cur && p.some((x) => x.id === cur)) return cur;
          const stored =
            typeof window !== "undefined" ? localStorage.getItem(SELECTED_KEY) : null;
          if (stored && p.some((x) => x.id === stored)) return stored;
          const def = p.find((x) => x.isDefault) ?? p[0];
          return def?.id ?? "";
        });
        setMounted(true);
      } catch {
        // ignore
      }
    }
    refresh();
    const off1 = onChange("reminders", refresh);
    const off2 = onChange("profiles", refresh);
    return () => {
      cancelled = true;
      off1();
      off2();
    };
  }, []);

  function chooseProfile(id: string | "all") {
    const value = id === "all" ? "" : id;
    setSelected(value);
    if (typeof window !== "undefined") {
      if (value) localStorage.setItem(SELECTED_KEY, value);
      else localStorage.removeItem(SELECTED_KEY);
    }
  }

  function chooseKind(next: ReminderKind) {
    setKind(next);
    if (typeof window !== "undefined") localStorage.setItem(KIND_KEY, next);
  }

  const meta = KIND_META[kind];

  const ofKind = useMemo(
    () => reminders.filter((r) => r.kind === kind),
    [reminders, kind],
  );
  const visible = useMemo(
    () => (selected ? ofKind.filter((r) => r.profileId === selected) : ofKind),
    [ofKind, selected],
  );

  const activeProfile = profiles.find((p) => p.id === selected);
  const newLabel = activeProfile ? `${meta.newLabel} · ${activeProfile.name}` : meta.newLabel;

  return (
    <Shell
      current="lembretes"
      header={
        <section className="mb-8">
          <div
            role="tablist"
            aria-label="Tipo de lembrete"
            className="mb-7 flex flex-wrap gap-2"
          >
            {KIND_ORDER.map((k) => {
              const m = KIND_META[k];
              const active = mounted && k === kind;
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => chooseKind(k)}
                  className={
                    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[14px] transition-all " +
                    (active
                      ? "bg-ink text-paper"
                      : "border border-edge-2 text-ink-soft hover:border-ink-soft hover:text-ink")
                  }
                >
                  {(() => {
                    const Icon = KIND_ICON[k];
                    return (
                      <Icon
                        size={14}
                        strokeWidth={1.75}
                        aria-hidden
                        style={{ color: active ? "var(--color-paper)" : m.dot }}
                      />
                    );
                  })()}
                  {m.plural}
                </button>
              );
            })}
          </div>
          <p className="text-[13px] uppercase tracking-[0.18em] text-ink-faint">
            Lembretes
          </p>
          <h1 className="mt-1 font-display text-[44px] leading-[1.05] tracking-tight text-ink">
            {meta.plural}
          </h1>
          {meta.blurb ? (
            <p className="mt-3 max-w-[44ch] text-[14px] leading-relaxed text-ink-soft">
              {meta.blurb}
            </p>
          ) : null}
        </section>
      }
    >
      {mounted ? (
        <ProfileBar
          profiles={profiles}
          selected={selected || "all"}
          onSelect={chooseProfile}
        />
      ) : null}

      {mounted && kind === "medication" ? <PrescriptionScan profileId={selected} /> : null}

      <section className="mb-14">
        <h2 className="mb-4 font-display text-[18px] tracking-tight text-ink-soft">
          {newLabel}
        </h2>
        {kind === "medication" ? (
          <MedForm key={`med-${selected}`} profileId={selected} />
        ) : (
          <OneShotForm key={`${kind}-${selected}`} profileId={selected} defaultKind={kind} />
        )}
      </section>

      {mounted ? (
        kind === "medication" ? (
          visible.length > 0 ? (
            <section>
              <h2 className="mb-2 font-display text-[18px] tracking-tight text-ink-soft">
                Cadastrados
              </h2>
              <MedList reminders={visible} profiles={profiles} />
            </section>
          ) : null
        ) : (
          <section>
            <UpcomingList
              reminders={visible}
              profiles={profiles}
              hideKindTag
              emptyUpcoming={`Nenhuma ${meta.noun.toLowerCase()} agendada.`}
              emptyHistory={`Nenhuma ${meta.noun.toLowerCase()} no histórico.`}
            />
          </section>
        )
      ) : null}
    </Shell>
  );
}
