"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell } from "../_components/shell";
import { ProfileBar } from "../_components/profile-bar";
import { DiaryActions } from "../_components/diary-actions";
import { ActivityList } from "../_components/activity-list";
import { getActivities, getConfig, getProfiles, onChange } from "@/lib/api";
import { addDays, formatBrDate, nowInTz } from "@/lib/schedule";
import { feedMethod, isFeed } from "@/lib/types";
import type { Activity, FeedSide, NapActivity, Profile } from "@/lib/types";

const SELECTED_KEY = "lr.profile.selected.v1";

export default function DiarioPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [openNaps, setOpenNaps] = useState<NapActivity[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tz, setTz] = useState("America/Sao_Paulo");
  const [selected, setSelected] = useState<string>("");
  const [viewDate, setViewDate] = useState("");
  const [mounted, setMounted] = useState(false);

  // Config + perfis (independente do dia visto).
  useEffect(() => {
    let cancelled = false;
    async function loadMeta() {
      try {
        const [cfg, p] = await Promise.all([getConfig(), getProfiles()]);
        if (cancelled) return;
        setTz(cfg.timezone);
        setProfiles(p);
        setViewDate((cur) => cur || nowInTz(cfg.timezone).date);
        setSelected((cur) => {
          if (cur && p.some((x) => x.id === cur)) return cur;
          const stored =
            typeof window !== "undefined" ? localStorage.getItem(SELECTED_KEY) : null;
          if (stored && p.some((x) => x.id === stored)) return stored;
          // Sem seleção salva, prefere um bebê que ainda mama (foco do diário),
          // depois o perfil padrão, depois o primeiro.
          const def = p.find((x) => x.aindaMama) ?? p.find((x) => x.isDefault) ?? p[0];
          return def?.id ?? "";
        });
        setMounted(true);
      } catch {
        // ignore
      }
    }
    loadMeta();
    const offP = onChange("profiles", loadMeta);
    const offC = onChange("config", loadMeta);
    return () => {
      cancelled = true;
      offP();
      offC();
    };
  }, []);

  // Atividades do dia visto. openNaps vem sempre atual (hoje+ontem), independente
  // do dia escolhido — o timer ao vivo não depende da navegação.
  useEffect(() => {
    if (!viewDate) return;
    let cancelled = false;
    async function loadDay() {
      try {
        const view = await getActivities(viewDate);
        if (cancelled) return;
        setActivities(view.activities);
        setOpenNaps(view.openNaps);
      } catch {
        // ignore
      }
    }
    loadDay();
    const offA = onChange("activities", loadDay);
    return () => {
      cancelled = true;
      offA();
    };
  }, [viewDate]);

  function chooseProfile(id: string | "all") {
    const value = id === "all" ? "" : id;
    setSelected(value);
    if (typeof window !== "undefined") {
      if (value) localStorage.setItem(SELECTED_KEY, value);
      else localStorage.removeItem(SELECTED_KEY);
    }
  }

  const visible = useMemo(
    () => (selected ? activities.filter((a) => a.profileId === selected) : activities),
    [activities, selected],
  );

  const openNap = useMemo(
    () => openNaps.find((n) => n.profileId === selected) ?? null,
    [openNaps, selected],
  );

  const lastFeedSide = useMemo<FeedSide | undefined>(() => {
    const feeds = visible
      .filter(isFeed)
      .filter((f) => feedMethod(f) === "breast" && f.side)
      .sort((a, b) => a.at - b.at);
    return feeds.length ? feeds[feeds.length - 1].side : undefined;
  }, [visible]);

  const activeProfile = profiles.find((p) => p.id === selected);

  const today = nowInTz(tz).date;
  const isToday = viewDate === today;
  const dayLabel = !viewDate
    ? ""
    : viewDate === today
      ? "Hoje"
      : viewDate === addDays(today, -1)
        ? "Ontem"
        : formatBrDate(viewDate);

  return (
    <Shell
      current="diario"
      header={
        <section className="mb-10">
          <p className="text-[13px] uppercase tracking-[0.18em] text-ink-faint">
            acompanhamento
          </p>
          <h1 className="mt-1 font-display text-[44px] leading-[1.05] tracking-tight text-ink">
            Diário
          </h1>
        </section>
      }
    >
      {mounted ? (
        <ProfileBar profiles={profiles} selected={selected || "all"} onSelect={chooseProfile} />
      ) : null}

      {mounted && selected && isToday ? (
        <DiaryActions
          profileId={selected}
          tz={tz}
          openNap={openNap}
          lastFeedSide={lastFeedSide}
          aindaMama={activeProfile?.aindaMama}
        />
      ) : null}

      {mounted ? (
        <section>
          <div className="mb-3 flex items-end justify-between gap-4 border-b border-edge pb-3">
            <h2 className="font-display text-[24px] leading-none tracking-tight text-ink">
              {dayLabel}
            </h2>
            <div
              className="inline-flex items-center rounded-full"
              style={{ border: "1px solid var(--color-edge-2)" }}
            >
              <DayStep
                dir="prev"
                onClick={() => setViewDate((d) => addDays(d, -1))}
                label="dia anterior"
              />
              <span aria-hidden className="h-5 w-px" style={{ background: "var(--color-edge-2)" }} />
              <DayStep
                dir="next"
                onClick={() => setViewDate((d) => addDays(d, 1))}
                disabled={isToday}
                label="próximo dia"
              />
            </div>
          </div>
          <ActivityList activities={visible} tz={tz} />
        </section>
      ) : null}
    </Shell>
  );
}

function DayStep({
  dir,
  onClick,
  label,
  disabled = false,
}: {
  dir: "prev" | "next";
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex size-11 items-center justify-center text-ink-soft transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d={dir === "prev" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
