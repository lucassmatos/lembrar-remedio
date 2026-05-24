"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell } from "../_components/shell";
import { MedForm } from "../_components/med-form";
import { MedList } from "../_components/med-list";
import { PrescriptionScan } from "../_components/prescription-scan";
import { ProfileBar } from "../_components/profile-bar";
import { getProfiles, getReminders, onChange } from "@/lib/api";
import type { ProfileWithAccess } from "@/lib/api";
import type { Reminder } from "@/lib/types";

const SELECTED_KEY = "lr.profile.selected.v1";

export default function MedicationsPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [profiles, setProfiles] = useState<ProfileWithAccess[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [r, p] = await Promise.all([getReminders(), getProfiles()]);
        if (cancelled) return;
        setReminders(r.filter((x) => x.kind === "medication"));
        setProfiles(p);
        setSelected((cur) => {
          if (cur && p.some((x) => x.id === cur)) return cur;
          const stored = typeof window !== "undefined" ? localStorage.getItem(SELECTED_KEY) : null;
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

  const visibleMeds = useMemo(
    () => (selected ? reminders.filter((m) => m.profileId === selected) : reminders),
    [reminders, selected],
  );

  const activeProfile = profiles.find((p) => p.id === selected);

  return (
    <Shell
      current="remedios"
      header={
        <section className="mb-10">
          <p className="text-[13px] uppercase tracking-[0.18em] text-ink-faint">
            Lembretes
          </p>
          <h1 className="mt-1 font-display text-[44px] leading-[1.05] tracking-tight text-ink">
            Medicamentos
          </h1>
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

      {mounted ? <PrescriptionScan profileId={selected} /> : null}

      <section className="mb-14">
        <h2 className="mb-4 font-display text-[18px] tracking-tight text-ink-soft">
          {activeProfile ? `Novo medicamento · ${activeProfile.name}` : "Novo medicamento"}
        </h2>
        <MedForm profileId={selected} />
      </section>

      {mounted && visibleMeds.length > 0 ? (
        <section>
          <h2 className="mb-2 font-display text-[18px] tracking-tight text-ink-soft">
            Cadastrados
          </h2>
          <MedList reminders={visibleMeds} profiles={profiles} />
        </section>
      ) : null}
    </Shell>
  );
}
