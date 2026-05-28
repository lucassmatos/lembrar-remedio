"use client";

import type { Activity, BottleContent, Config, DayLog, FeedSide, HouseList, HouseRoutine, ListItem, ListKind, NapActivity, Profile, Reminder, RoutineFreq } from "./types";

const EVT = "lr:change";
type Scope = "reminders" | "config" | "log" | "profiles" | "activities" | "lists" | "routines";

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
  patch: { name?: string; color?: string; aindaMama?: boolean },
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

export async function disconnectTelegram(): Promise<void> {
  await jsonFetch("/api/telegram/disconnect", { method: "POST" });
  emit("config");
}

export async function sendTestNotification(
  channel: "push" | "telegram",
): Promise<{ telegram?: string; push?: string }> {
  const data = await jsonFetch<{ result: { telegram?: string; push?: string } }>(
    "/api/notify/test",
    { method: "POST", body: JSON.stringify({ channel }) },
  );
  return data.result;
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

export type FeedInput =
  | { method: "breast"; side: FeedSide }
  | { method: "bottle"; amountMl: number; content: BottleContent }
  | { method: "pump"; amountMl: number; side: FeedSide };

export async function logFeed(profileId: string, input: FeedInput): Promise<Activity> {
  const data = await jsonFetch<{ activity: Activity }>("/api/activities", {
    method: "POST",
    body: JSON.stringify({ type: "feed", profileId: profileId || undefined, ...input }),
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
    amountMl?: number;
    content?: BottleContent;
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

// Re-emite todos os escopos pra forçar as telas montadas a refazer o fetch.
// Usado quando a aba volta ao foco: o sync é por evento intra-aba, então sem
// isso dados mexidos noutro aparelho (ex.: lista da casa pelo parceiro) só
// apareciam ao recarregar a página na mão. Throttle evita refetch duplicado
// quando focus e visibilitychange disparam juntos.
const ALL_SCOPES: Scope[] = ["reminders", "config", "log", "profiles", "activities", "lists", "routines"];
let lastRefetchAll = 0;
export function refetchAll() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastRefetchAll < 1000) return;
  lastRefetchAll = now;
  for (const s of ALL_SCOPES) emit(s);
}

// ── Recados da Casa ───────────────────────────────────────────────────────────

export async function getHouseLists(): Promise<HouseList[]> {
  const data = await jsonFetch<{ lists: HouseList[] }>("/api/lists");
  return data.lists;
}

export type ListDetail = { list: HouseList; items: ListItem[] };

export async function getListDetail(ownerSub: string, id: string): Promise<ListDetail> {
  return jsonFetch<ListDetail>(`/api/lists/${id}?ownerSub=${encodeURIComponent(ownerSub)}`);
}

export async function createList(title: string, kind: ListKind = "custom"): Promise<HouseList> {
  const data = await jsonFetch<{ list: HouseList }>("/api/lists", {
    method: "POST",
    body: JSON.stringify({ title, kind }),
  });
  emit("lists");
  return data.list;
}

export async function deleteList(ownerSub: string, id: string): Promise<void> {
  await jsonFetch(`/api/lists/${id}?ownerSub=${encodeURIComponent(ownerSub)}`, { method: "DELETE" });
  emit("lists");
}

export async function addItem(ownerSub: string, listId: string, text: string): Promise<ListItem> {
  const data = await jsonFetch<{ item: ListItem }>(
    `/api/lists/${listId}/items?ownerSub=${encodeURIComponent(ownerSub)}`,
    { method: "POST", body: JSON.stringify({ text }) },
  );
  emit("lists");
  return data.item;
}

export async function setItemDone(
  ownerSub: string,
  listId: string,
  itemId: string,
  done: boolean,
): Promise<ListItem> {
  const data = await jsonFetch<{ item: ListItem }>(
    `/api/lists/${listId}/items?ownerSub=${encodeURIComponent(ownerSub)}`,
    { method: "PATCH", body: JSON.stringify({ itemId, done }) },
  );
  emit("lists");
  return data.item;
}

export async function deleteItem(ownerSub: string, listId: string, itemId: string): Promise<void> {
  await jsonFetch(
    `/api/lists/${listId}/items?ownerSub=${encodeURIComponent(ownerSub)}&itemId=${encodeURIComponent(itemId)}`,
    { method: "DELETE" },
  );
  emit("lists");
}

// ── Rotinas da Casa ───────────────────────────────────────────────────────────

export type RoutineWithStatus = HouseRoutine & {
  currentPeriod: string;
  doneInPeriod: boolean;
  doneBy?: string;
  /**
   * Próxima ocorrência relevante pra Timeline (monthly/weekly):
   *  - se period atual não foi feito: aponta pro anchor desse período (pode
   *    estar `isOverdue` se já passou)
   *  - senão: aponta pro próximo período, dentro do lookahead da freq
   *  - daily não tem `next` (vive só em "Rotinas de hoje")
   */
  next?: {
    date: string;
    period: string;
    daysAway: number;
    isOverdue: boolean;
    done: boolean;
  } | null;
};

export type RoutineInput = {
  title: string;
  freq: RoutineFreq;
  anchor?: number;
  time?: string;
};

export async function getRoutines(): Promise<RoutineWithStatus[]> {
  const data = await jsonFetch<{ routines: RoutineWithStatus[] }>("/api/routines");
  return data.routines;
}

export async function createRoutine(input: RoutineInput): Promise<HouseRoutine> {
  const data = await jsonFetch<{ routine: HouseRoutine }>("/api/routines", {
    method: "POST",
    body: JSON.stringify(input),
  });
  emit("routines");
  return data.routine;
}

export async function deleteRoutine(ownerSub: string, id: string): Promise<void> {
  await jsonFetch(`/api/routines/${id}?ownerSub=${encodeURIComponent(ownerSub)}`, {
    method: "DELETE",
  });
  emit("routines");
}

export async function markRoutineDone(
  ownerSub: string,
  routineId: string,
  period: string,
): Promise<void> {
  await jsonFetch(`/api/routines/${routineId}/done?ownerSub=${encodeURIComponent(ownerSub)}`, {
    method: "POST",
    body: JSON.stringify({ period }),
  });
  emit("routines");
}

export async function unmarkRoutineDone(
  ownerSub: string,
  routineId: string,
  period: string,
): Promise<void> {
  await jsonFetch(
    `/api/routines/${routineId}/done?ownerSub=${encodeURIComponent(ownerSub)}&period=${encodeURIComponent(period)}`,
    { method: "DELETE" },
  );
  emit("routines");
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
