"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "./_components/shell";
import { Timeline } from "./_components/timeline";
import { getActivities, getConfig, getProfiles, getReminders, onChange } from "@/lib/api";
import { nowInTz } from "@/lib/schedule";
import type { NapActivity, Profile, Reminder } from "@/lib/types";

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export default function TimelinePage() {
  const router = useRouter();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [openNaps, setOpenNaps] = useState<NapActivity[]>([]);
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
        // "Tela inicial = Diário": redireciona só uma vez por abertura do app
        // (sessionStorage), pra clicar em Timeline na nav não ficar preso.
        if (
          cfg.startScreen === "diario" &&
          typeof window !== "undefined" &&
          !sessionStorage.getItem("lr.startedDiario")
        ) {
          sessionStorage.setItem("lr.startedDiario", "1");
          router.replace("/diario");
          return;
        }
        const now = nowInTz(cfg.timezone);
        const view = await getActivities(now.date).catch(() => null);
        if (cancelled) return;
        setReminders(r);
        setProfiles(p);
        setOpenNaps(view?.openNaps ?? []);
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
    const off5 = onChange("activities", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
      off1();
      off2();
      off3();
      off4();
      off5();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

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
          openNaps={openNaps}
          nowMinutes={minutes}
        />
      ) : null}
    </Shell>
  );
}
