"use client";

import { useEffect, useRef } from "react";
import { loadConfig, loadLog, loadMeds, markNotified, pruneOld, wasNotified } from "@/lib/storage";
import { nowInTz, slotKey, todaySlots } from "@/lib/schedule";

const NEAR_BEFORE_MIN = 0;
const NEAR_AFTER_MIN = 15;
const TICK_MS = 30_000;

export function NotificationManager() {
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    pruneOld();
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    function tick() {
      try {
        if (Notification.permission !== "granted") return;
        const cfg = loadConfig();
        const { date, minutes } = nowInTz(cfg.timezone);
        const meds = loadMeds();
        if (meds.length === 0) return;
        const log = loadLog(date);
        const slots = todaySlots(meds, log);
        for (const s of slots) {
          if (s.taken) continue;
          if (s.minutes < minutes - NEAR_AFTER_MIN) continue;
          if (s.minutes > minutes + NEAR_BEFORE_MIN) continue;
          const key = slotKey(s.medId, s.time);
          if (wasNotified(date, key)) continue;
          fire(s.med.name, s.med.dosage, s.time);
          markNotified(date, key);
        }
      } catch {
        // shrug
      }
    }

    tick();
    tickRef.current = window.setInterval(tick, TICK_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  return null;
}

function fire(name: string, dosage: string | undefined, time: string) {
  const title = `Hora do remédio · ${time}`;
  const body = dosage ? `${name} · ${dosage}` : name;
  const opts: NotificationOptions = {
    body,
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: `lr-${time}-${name}`,
    requireInteraction: true,
  };
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready
      .then((reg) => reg.showNotification(title, opts))
      .catch(() => new Notification(title, opts));
  } else {
    try {
      new Notification(title, opts);
    } catch {
      // ignore
    }
  }
}
