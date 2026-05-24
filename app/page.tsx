"use client";

import { useEffect, useState } from "react";
import { Shell } from "./_components/shell";
import { Timeline } from "./_components/timeline";
import { getConfig, getProfiles, getReminders, onChange } from "@/lib/api";
import { nowInTz } from "@/lib/schedule";
import type { Profile, Reminder } from "@/lib/types";

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export default function TimelinePage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
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
        setReminders(r);
        setProfiles(p);
        setTz(cfg.timezone);
        setDate(now.date);
        setMinutes(now.minutes);
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
    const off4 = onChange("log", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
      off1();
      off2();
      off3();
      off4();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const localDate = date ? new Date(date + "T12:00:00") : null;
  const dayWord = localDate ? WEEKDAY[localDate.getDay()] : " ";
  const dateLine = localDate
    ? `${localDate.getDate()} de ${MONTH[localDate.getMonth()]}`
    : " ";

  return (
    <Shell
      current="timeline"
      header={
        <section className="mb-10">
          <p className="text-[13px] uppercase tracking-[0.18em] text-ink-faint">
            {mounted ? dayWord : " "}
          </p>
          <h1 className="mt-1 font-display text-[44px] leading-[1.05] tracking-tight text-ink">
            {mounted ? dateLine : "Timeline"}
          </h1>
          <p className="mt-3 max-w-[44ch] text-[13px] leading-relaxed text-ink-soft">
            Tudo da casa num lugar só. Hoje + o que vem.
          </p>
        </section>
      }
    >
      {mounted ? (
        <Timeline
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
