"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell } from "../_components/shell";
import { OneShotForm } from "../_components/one-shot-form";
import { UpcomingList } from "../_components/upcoming-list";
import { ProfileBar } from "../_components/profile-bar";
import { getProfiles, getReminders, onChange } from "@/lib/api";
import type { Profile, Reminder } from "@/lib/types";

const SELECTED_KEY = "lr.profile.selected.v1";

export default function UpcomingPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [r, p] = await Promise.all([getReminders(), getProfiles()]);
        if (cancelled) return;
        setReminders(r.filter((x) => x.kind !== "medication"));
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

  const visible = useMemo(
    () => (selected ? reminders.filter((r) => r.profileId === selected) : reminders),
    [reminders, selected],
  );

  const activeProfile = profiles.find((p) => p.id === selected);

  return (
    <Shell
      current="proximos"
      header={
        <section className="mb-10">
          <p className="text-[13px] uppercase tracking-[0.18em] text-ink-faint">
            agenda
          </p>
          <h1 className="mt-1 font-display text-[44px] leading-[1.05] tracking-tight text-ink">
            Próximos
          </h1>
          <p className="mt-3 max-w-[44ch] text-[14px] leading-relaxed text-ink-soft">
            Vacinas e retornos. Eu lembro de marcar com antecedência, e de novo perto da data.
          </p>
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

      <section className="mb-14">
        <h2 className="mb-4 font-display text-[18px] tracking-tight text-ink-soft">
          {activeProfile ? `Novo · ${activeProfile.name}` : "Novo"}
        </h2>
        <OneShotForm profileId={selected} />
      </section>

      {mounted ? (
        <section>
          <UpcomingList reminders={visible} profiles={profiles} />
        </section>
      ) : null}
    </Shell>
  );
}
