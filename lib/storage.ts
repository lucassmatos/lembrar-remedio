"use client";

import { useEffect, useState } from "react";
import type { Config, DayLog, Medication } from "./types";

const KEY = {
  meds: "lr.meds.v1",
  config: "lr.config.v1",
  openai: "lr.openai.v1",
  openaiModel: "lr.openai.model.v1",
  log: (date: string) => `lr.log.${date}`,
  notified: (date: string) => `lr.notified.${date}`,
};

export const DEFAULT_OPENAI_MODEL = "gpt-5.4";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("lr:change", { detail: { key } }));
}

export function loadMeds(): Medication[] {
  return read<Medication[]>(KEY.meds, []);
}

export function saveMeds(meds: Medication[]): void {
  write(KEY.meds, meds);
}

export function loadConfig(): Config {
  return read<Config>(KEY.config, {
    timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/Sao_Paulo",
  });
}

export function saveConfig(cfg: Config): void {
  write(KEY.config, cfg);
}

export function loadOpenAIKey(): string {
  return read<string>(KEY.openai, "");
}

export function saveOpenAIKey(key: string): void {
  if (typeof window === "undefined") return;
  const trimmed = key.trim();
  if (!trimmed) {
    localStorage.removeItem(KEY.openai);
    window.dispatchEvent(new CustomEvent("lr:change", { detail: { key: KEY.openai } }));
    return;
  }
  write(KEY.openai, trimmed);
}

export function loadOpenAIModel(): string {
  const stored = read<string>(KEY.openaiModel, "");
  return stored.trim() || DEFAULT_OPENAI_MODEL;
}

export function saveOpenAIModel(model: string): void {
  if (typeof window === "undefined") return;
  const trimmed = model.trim();
  if (!trimmed || trimmed === DEFAULT_OPENAI_MODEL) {
    localStorage.removeItem(KEY.openaiModel);
    window.dispatchEvent(new CustomEvent("lr:change", { detail: { key: KEY.openaiModel } }));
    return;
  }
  write(KEY.openaiModel, trimmed);
}

export function loadLog(date: string): DayLog {
  return read<DayLog>(KEY.log(date), {});
}

export function saveLogEntry(date: string, slotKey: string, taken: boolean): DayLog {
  const log = loadLog(date);
  if (taken) log[slotKey] = { taken: true, takenAt: Date.now() };
  else delete log[slotKey];
  write(KEY.log(date), log);
  return log;
}

export function wasNotified(date: string, slotKey: string): boolean {
  const set = read<string[]>(KEY.notified(date), []);
  return set.includes(slotKey);
}

export function markNotified(date: string, slotKey: string): void {
  const set = read<string[]>(KEY.notified(date), []);
  if (!set.includes(slotKey)) {
    set.push(slotKey);
    write(KEY.notified(date), set);
  }
}

export function pruneOld(): void {
  if (typeof window === "undefined") return;
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k) continue;
    const m = k.match(/^lr\.(log|notified)\.(\d{4}-\d{2}-\d{2})$/);
    if (!m) continue;
    const t = new Date(m[2] + "T00:00:00Z").getTime();
    if (t < cutoff) localStorage.removeItem(k);
  }
}

export function useLocalStorageValue<T>(key: string, loader: () => T): [T, () => void] {
  const [value, setValue] = useState<T>(loader);
  const [, force] = useState(0);
  useEffect(() => {
    setValue(loader());
    function refresh(e: Event) {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (!detail || detail.key === key) {
        setValue(loader());
        force((n) => n + 1);
      }
    }
    function storage(e: StorageEvent) {
      if (e.key === key || e.key === null) {
        setValue(loader());
        force((n) => n + 1);
      }
    }
    window.addEventListener("lr:change", refresh as EventListener);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("lr:change", refresh as EventListener);
      window.removeEventListener("storage", storage);
    };
  }, [key]);
  return [value, () => setValue(loader())];
}

export const KEYS = KEY;
