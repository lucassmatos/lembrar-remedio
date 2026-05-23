"use client";

import type { Config, DayLog, Medication } from "./types";

const EVT = "lr:change";

function emit(scope: "meds" | "config" | "log") {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVT, { detail: { key: scope } }));
  }
}

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  if (res.status === 401) {
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("unauthenticated");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function getMeds(): Promise<Medication[]> {
  const data = await jsonFetch<{ meds: Medication[] }>("/api/medications");
  return data.meds;
}

export async function addMed(med: Omit<Medication, "id" | "createdAt">): Promise<Medication> {
  const data = await jsonFetch<{ med: Medication }>("/api/medications", {
    method: "POST",
    body: JSON.stringify(med),
  });
  emit("meds");
  return data.med;
}

export async function updateMed(id: string, patch: Partial<Medication>): Promise<Medication> {
  const data = await jsonFetch<{ med: Medication }>(`/api/medications/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  emit("meds");
  return data.med;
}

export async function deleteMed(id: string): Promise<void> {
  await jsonFetch(`/api/medications/${id}`, { method: "DELETE" });
  emit("meds");
}

export async function getConfig(): Promise<Config> {
  const data = await jsonFetch<{ config: Config }>("/api/config");
  return data.config;
}

export async function setConfig(patch: Partial<Config>): Promise<Config> {
  const data = await jsonFetch<{ config: Config }>("/api/config", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  emit("config");
  return data.config;
}

export async function getLog(date: string): Promise<DayLog> {
  const data = await jsonFetch<{ log: DayLog }>(`/api/log?date=${encodeURIComponent(date)}`);
  return data.log;
}

export async function setLogEntry(
  date: string,
  slotKey: string,
  taken: boolean,
): Promise<DayLog> {
  const data = await jsonFetch<{ log: DayLog }>("/api/log", {
    method: "POST",
    body: JSON.stringify({ date, slotKey, taken }),
  });
  emit("log");
  return data.log;
}

export function onChange(scope: "meds" | "config" | "log" | "any", handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  function listener(e: Event) {
    const detail = (e as CustomEvent<{ key: string }>).detail;
    if (scope === "any" || !detail || detail.key === scope) handler();
  }
  window.addEventListener(EVT, listener);
  return () => window.removeEventListener(EVT, listener);
}
