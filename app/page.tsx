"use client";

import { useEffect, useState } from "react";
import { Shell } from "./_components/shell";
import { TodayList } from "./_components/today-list";
import { NotificationManager } from "./_components/notification-manager";
import { PermissionBanner } from "./_components/permission-banner";
import { loadConfig, loadLog, loadMeds } from "@/lib/storage";
import { nowInTz, todaySlots } from "@/lib/schedule";
import type { Medication } from "@/lib/types";

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export default function Page() {
  const [mounted, setMounted] = useState(false);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [date, setDate] = useState("2026-01-01");
  const [minutes, setMinutes] = useState(0);
  const [counts, setCounts] = useState({ taken: 0, total: 0 });

  useEffect(() => {
    function refresh() {
      const cfg = loadConfig();
      const now = nowInTz(cfg.timezone);
      const m = loadMeds();
      const log = loadLog(now.date);
      const slots = todaySlots(m, log);
      setMeds(m);
      setDate(now.date);
      setMinutes(now.minutes);
      setCounts({ taken: slots.filter((s) => s.taken).length, total: slots.length });
      setMounted(true);
    }
    refresh();
    const id = window.setInterval(refresh, 60_000);
    window.addEventListener("lr:change", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("lr:change", refresh);
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
            {mounted ? dayWord : " "}
          </p>
          <h1 className="mt-1 font-display text-[44px] leading-[1.05] tracking-tight text-ink">
            {mounted ? dateLine : " "}
          </h1>
          {mounted && counts.total > 0 ? (
            <p className="mt-3 text-[14px] tnum text-ink-soft">
              {counts.taken} de {counts.total} tomados hoje
            </p>
          ) : null}
        </section>
      }
    >
      <NotificationManager />
      <PermissionBanner />
      {mounted ? <TodayList date={date} meds={meds} nowMinutes={minutes} /> : null}
    </Shell>
  );
}
