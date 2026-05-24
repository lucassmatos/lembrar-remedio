"use client";

import type { Config, DayLog, Profile, Reminder } from "./types";

const EVT = "lr:change";
type Scope = "reminders" | "config" | "log" | "profiles";

function emit(scope: Scope) {
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

export async function getReminders(): Promise<Reminder[]> {
  const data = await jsonFetch<{ reminders: Reminder[] }>("/api/reminders");
  return data.reminders;
}

export async function addReminder(
  reminder: Omit<Reminder, "id" | "createdAt">,
): Promise<Reminder> {
  const data = await jsonFetch<{ reminder: Reminder }>("/api/reminders", {
    method: "POST",
    body: JSON.stringify(reminder),
  });
  emit("reminders");
  return data.reminder;
}

export async function updateReminder(
  id: string,
  patch: Partial<Reminder>,
): Promise<Reminder> {
  const data = await jsonFetch<{ reminder: Reminder }>(`/api/reminders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  emit("reminders");
  return data.reminder;
}

export async function deleteReminder(id: string): Promise<void> {
  await jsonFetch(`/api/reminders/${id}`, { method: "DELETE" });
  emit("reminders");
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

export async function getProfiles(): Promise<Profile[]> {
  const data = await jsonFetch<{ profiles: Profile[] }>("/api/profiles");
  return data.profiles;
}

export async function addProfile(name: string, color?: string): Promise<Profile> {
  const data = await jsonFetch<{ profile: Profile }>("/api/profiles", {
    method: "POST",
    body: JSON.stringify({ name, color }),
  });
  emit("profiles");
  return data.profile;
}

export async function updateProfile(
  id: string,
  patch: { name?: string; color?: string },
): Promise<Profile> {
  const data = await jsonFetch<{ profile: Profile }>(`/api/profiles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  emit("profiles");
  return data.profile;
}

export async function deleteProfile(id: string): Promise<void> {
  await jsonFetch(`/api/profiles/${id}`, { method: "DELETE" });
  emit("profiles");
  emit("reminders");
}

export function onChange(
  scope: Scope | "any",
  handler: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  function listener(e: Event) {
    const detail = (e as CustomEvent<{ key: string }>).detail;
    if (scope === "any" || !detail || detail.key === scope) handler();
  }
  window.addEventListener(EVT, listener);
  return () => window.removeEventListener(EVT, listener);
}
