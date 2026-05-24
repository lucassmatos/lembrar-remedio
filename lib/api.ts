"use client";

import type { Activity, Config, DayLog, FeedSide, NapActivity, Profile, Reminder } from "./types";

const EVT = "lr:change";
type Scope = "reminders" | "config" | "log" | "profiles" | "activities";

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

export type ProfileWithAccess = Profile & {
  accessRole?: "owner" | "partner" | "caregiver";
};

export async function getProfiles(): Promise<ProfileWithAccess[]> {
  const data = await jsonFetch<{ profiles: ProfileWithAccess[] }>("/api/profiles");
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

export type ActivitiesView = {
  date: string;
  activities: Activity[];
  openNaps: NapActivity[];
};

export async function getActivities(date: string): Promise<ActivitiesView> {
  return jsonFetch<ActivitiesView>(`/api/activities?date=${encodeURIComponent(date)}`);
}

export async function startNap(profileId: string): Promise<Activity> {
  const data = await jsonFetch<{ activity: Activity }>("/api/activities", {
    method: "POST",
    body: JSON.stringify({ type: "nap", profileId: profileId || undefined }),
  });
  emit("activities");
  return data.activity;
}

export async function stopNap(nap: NapActivity): Promise<Activity> {
  return updateActivity(nap.id, { date: nap.date, endedAt: Date.now() });
}

export async function logFeed(profileId: string, side: FeedSide): Promise<Activity> {
  const data = await jsonFetch<{ activity: Activity }>("/api/activities", {
    method: "POST",
    body: JSON.stringify({ type: "feed", side, profileId: profileId || undefined }),
  });
  emit("activities");
  return data.activity;
}

export async function updateActivity(
  id: string,
  patch: {
    date: string;
    startedAt?: number;
    endedAt?: number | null;
    side?: FeedSide;
    at?: number;
  },
): Promise<Activity> {
  const data = await jsonFetch<{ activity: Activity }>(`/api/activities/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  emit("activities");
  return data.activity;
}

export async function deleteActivity(id: string, date: string): Promise<void> {
  await jsonFetch(`/api/activities/${id}?date=${encodeURIComponent(date)}`, { method: "DELETE" });
  emit("activities");
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

// ── Sharing ───────────────────────────────────────────────────────────────────

export type SharingPartner = {
  partnerSub: string;
  partnerEmail?: string;
  partnerName?: string;
};

export type SharingCaregiver = {
  sub: string;
  profileId: string;
  profileName: string;
  addedAt: number;
};

export type SharingMemberOf = {
  ownerSub: string;
  profileId: string;
  profileName: string;
  role: string;
};

export type SharingData = {
  partner: SharingPartner | null;
  caregivers: SharingCaregiver[];
  memberOf: SharingMemberOf[];
};

export type InviteResult = {
  token: string;
  url: string;
  expiresInSec: number;
};

export async function getSharing(): Promise<SharingData> {
  return jsonFetch<SharingData>("/api/sharing");
}

export async function createInvite(
  body:
    | { mode: "partner"; inviteeEmail: string }
    | { mode: "caregiver"; profileIds: string[]; inviteeEmail: string },
): Promise<InviteResult> {
  return jsonFetch<InviteResult>("/api/sharing/invite", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function acceptInvite(token: string): Promise<{ ok: true }> {
  const result = await jsonFetch<{ ok: true }>("/api/sharing/accept", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  emit("profiles");
  return result;
}

export async function removeShare(
  body:
    | { kind: "caregiver"; profileId: string; memberSub: string }
    | { kind: "partner" }
    | { kind: "leave"; ownerSub: string; profileId: string },
): Promise<{ ok: true }> {
  const result = await jsonFetch<{ ok: true }>("/api/sharing", {
    method: "DELETE",
    body: JSON.stringify(body),
  });
  emit("profiles");
  return result;
}
