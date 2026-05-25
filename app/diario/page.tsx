"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell } from "../_components/shell";
import { ProfileBar } from "../_components/profile-bar";
import { DiaryActions } from "../_components/diary-actions";
import { ActivityList } from "../_components/activity-list";
import { getActivities, getConfig, getProfiles, onChange } from "@/lib/api";
import { nowInTz } from "@/lib/schedule";
import { feedMethod, isFeed } from "@/lib/types";
import type { Activity, FeedSide, NapActivity, Profile } from "@/lib/types";

const SELECTED_KEY = "lr.profile.selected.v1";

export default function DiarioPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [openNaps, setOpenNaps] = useState<NapActivity[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tz, setTz] = useState("America/Sao_Paulo");
  const [selected, setSelected] = useState<string>("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [cfg, p] = await Promise.all([getConfig(), getProfiles()]);
        if (cancelled) return;
        const today = nowInTz(cfg.timezone).date;
        const view = await getActivities(today);
        if (cancelled) return;
        setTz(cfg.timezone);
        setProfiles(p);
        setActivities(view.activities);
        setOpenNaps(view.openNaps);
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
    refresh();
    const offA = onChange("activities", refresh);
    const offP = onChange("profiles", refresh);
    const offC = onChange("config", refresh);
    return () => {
      cancelled = true;
      offA();
      offP();
      offC();
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

      {mounted && selected ? (
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
          <h2 className="mb-2 font-display text-[18px] tracking-tight text-ink-soft">
            {activeProfile ? `Hoje · ${activeProfile.name}` : "Hoje"}
          </h2>
          <ActivityList activities={visible} tz={tz} />
        </section>
      ) : null}
    </Shell>
  );
}
