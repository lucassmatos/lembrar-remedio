"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell } from "../_components/shell";
import { MedForm } from "../_components/med-form";
import { MedList } from "../_components/med-list";
import { PrescriptionScan } from "../_components/prescription-scan";
import { ProfileBar } from "../_components/profile-bar";
import { TodayList } from "../_components/today-list";
import {
  getConfig,
  getProfiles,
  getReminders,
  onChange,
} from "@/lib/api";
import { nowInTz } from "@/lib/schedule";
import type { Profile, Reminder } from "@/lib/types";

const SELECTED_KEY = "lr.profile.selected.v1";
const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export default function MedicationsPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [mounted, setMounted] = useState(false);
  const [tz, setTz] = useState("America/Sao_Paulo");
  const [date, setDate] = useState("");
  const [minutes, setMinutes] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [cfg, r, p] = await Promise.all([
          getConfig(),
          getReminders(),
          getProfiles(),
        ]);
        if (cancelled) return;
        const now = nowInTz(cfg.timezone);
        setReminders(r.filter((x) => x.kind === "medication"));
        setProfiles(p);
        setTz(cfg.timezone);
        setDate(now.date);
        setMinutes(now.minutes);
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
    const tick = window.setInterval(refresh, 60_000);
    const off1 = onChange("reminders", refresh);
    const off2 = onChange("profiles", refresh);
    const off3 = onChange("config", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
      off1();
      off2();
      off3();
      document.removeEventListener("visibilitychange", refresh);
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

  const localDate = date ? new Date(date + "T12:00:00") : null;
  const dayWord = localDate ? WEEKDAY[localDate.getDay()] : " ";
  const dateLine = localDate
    ? `${localDate.getDate()} de ${MONTH[localDate.getMonth()]}`
    : " ";

  return (
    <Shell
      current="remedios"
      header={
        <section className="mb-10">
          <p className="text-[13px] uppercase tracking-[0.18em] text-ink-faint">
            saúde
          </p>
          <h1 className="mt-1 font-display text-[44px] leading-[1.05] tracking-tight text-ink">
            Remédios
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

      {mounted && visibleMeds.length > 0 ? (
        <section className="mb-14">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-display text-[20px] tracking-tight text-ink">
              Hoje
            </h2>
            <p className="text-[13px] tnum text-ink-faint">
              {dayWord}, {dateLine}
            </p>
          </div>
          <TodayList
            date={date}
            tz={tz}
            reminders={visibleMeds}
            profiles={profiles}
            nowMinutes={minutes}
          />
        </section>
      ) : null}

      {mounted ? <PrescriptionScan profileId={selected} /> : null}

      <section className="mb-14">
        <h2 className="mb-4 font-display text-[18px] tracking-tight text-ink-soft">
          {activeProfile ? `Novo remédio · ${activeProfile.name}` : "Novo remédio"}
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
