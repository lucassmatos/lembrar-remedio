"use client";

import { useEffect, useState } from "react";
import { Shell } from "./_components/shell";
import { TodayList } from "./_components/today-list";
import { getConfig, getLog, getProfiles, getReminders, onChange } from "@/lib/api";
import { nowInTz, todaySlots } from "@/lib/schedule";
import type { Profile, Reminder } from "@/lib/types";

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export default function Page() {
  const [mounted, setMounted] = useState(false);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tz, setTz] = useState("America/Sao_Paulo");
  const [date, setDate] = useState("2026-01-01");
  const [minutes, setMinutes] = useState(0);
  const [counts, setCounts] = useState({ taken: 0, total: 0 });

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [cfg, r, p] = await Promise.all([getConfig(), getReminders(), getProfiles()]);
        const meds = r.filter((x) => x.kind === "medication");
        const now = nowInTz(cfg.timezone);
        const log = await getLog(now.date);
        if (cancelled) return;
        const slots = todaySlots(meds, log, { date: now.date, tz: cfg.timezone });
        setTz(cfg.timezone);
        setReminders(meds);
        setProfiles(p);
        setDate(now.date);
        setMinutes(now.minutes);
        setCounts({ taken: slots.filter((s) => s.taken).length, total: slots.length });
        setMounted(true);
      } catch {
        // requireSession may redirect
      }
    }
    refresh();
    const id = window.setInterval(refresh, 60_000);
    const off = onChange("any", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      off();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const localDate = new Date(date + "T12:00:00");
  const dayWord = WEEKDAY[localDate.getDay()];
  const dateLine = `${localDate.getDate()} de ${MONTH[localDate.getMonth()]}`;

  return (
    <Shell
      current="hoje"
      header={
        <section className="mb-10">
          <p className="text-[13px] uppercase tracking-[0.18em] text-ink-faint">
            {mounted ? dayWord : " "}
          </p>
          <h1 className="mt-1 font-display text-[44px] leading-[1.05] tracking-tight text-ink">
            {mounted ? dateLine : " "}
          </h1>
          {mounted && counts.total > 0 ? (
            <p className="mt-3 text-[14px] tnum text-ink-soft">
              {counts.taken} de {counts.total} tomados hoje
            </p>
          ) : null}
        </section>
      }
    >
      {mounted ? (
        <TodayList
          date={date}
          tz={tz}
          reminders={reminders}
          profiles={profiles}
          nowMinutes={minutes}
        />
      ) : null}
    </Shell>
  );
}
