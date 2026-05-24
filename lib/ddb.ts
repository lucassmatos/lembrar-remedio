import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { nanoid } from "nanoid";
import type {
  Activity,
  Config,
  DayLog,
  NapActivity,
  PartnerRecord,
  Profile,
  ProfileColor,
  ProfileShareEntry,
  ProfileShareLink,
  ProfileShareRole,
  Reminder,
  ReminderStatus,
} from "./types";
import { isOngoingNap, PROFILE_COLORS } from "./types";
import { addDays, nowInTz } from "./schedule";
import { activityTime } from "./activity";
import { devDoc, isDevLocal } from "./dev-store";

const TABLE = process.env.DDB_TABLE_NAME || "lembrar-remedio";
const REGION = process.env.LR_AWS_REGION || process.env.AWS_REGION || "us-east-1";

// Só usa creds estáticas se LR_AWS_* estiverem setados (caso Vercel).
// Em Lambda, deixa o SDK usar o default credential provider chain (role da Lambda).
const lrAccessKey = process.env.LR_AWS_ACCESS_KEY_ID;
const lrSecretKey = process.env.LR_AWS_SECRET_ACCESS_KEY;

const realDoc = (() => {
  const raw = new DynamoDBClient({
    region: REGION,
    credentials: lrAccessKey && lrSecretKey
      ? { accessKeyId: lrAccessKey, secretAccessKey: lrSecretKey }
      : undefined,
  });
  return DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
  });
})();

const doc = (isDevLocal() ? devDoc : realDoc) as typeof realDoc;

const PK = {
  user: (sub: string) => `user#${sub}`,
  profile: (profileId: string) => `profile#${profileId}`,
  pair: (token: string) => `pair#${token}`,
  chat: (chatId: number) => `chat#${chatId}`,
  users: "users",
};
const SK = {
  config: "config",
  partner: "partner",
  reminder: (id: string) => `reminder#${id}`,
  profile: (id: string) => `profile#${id}`,
  log: (date: string) => `log#${date}`,
  activity: (date: string, id: string) => `activity#${date}#${id}`,
  notified: (date: string) => `notified#${date}`,
  pair: "pair",
  chat: "chat",
  userIndex: (sub: string) => `user#${sub}`,
  shareLink: (ownerSub: string, profileId: string) =>
    `shared#${ownerSub}#${profileId}`,
};

export async function ensureUser(
  sub: string,
  meta: { email?: string | null; name?: string | null },
): Promise<Config> {
  const existing = await getConfig(sub);
  if (existing._registered) {
    await ensureDefaultProfile(sub, meta.name);
    return existing;
  }
  const cfg: Config & { _registered?: boolean } = {
    timezone: "America/Sao_Paulo",
    email: meta.email ?? undefined,
    name: meta.name ?? undefined,
    createdAt: Date.now(),
    _registered: true,
  };
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK.user(sub), sk: SK.config, ...cfg },
    }),
  );
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK.users, sk: SK.userIndex(sub), sub, email: meta.email ?? undefined },
    }),
  );
  await ensureDefaultProfile(sub, meta.name);
  return cfg;
}

export async function ensureDefaultProfile(
  sub: string,
  fallbackName?: string | null,
): Promise<Profile> {
  const existing = await listProfiles(sub);
  const def = existing.find((p) => p.isDefault);
  if (def) return def;
  if (existing.length > 0) {
    const first = existing[0];
    const updated: Profile = { ...first, isDefault: true };
    await putProfile(sub, updated);
    return updated;
  }
  const profile: Profile = {
    id: nanoid(8),
    name: (fallbackName?.trim() || "Eu").slice(0, 40),
    color: "sage",
    isDefault: true,
    createdAt: Date.now(),
    ownerSub: sub,
    sharedWith: [],
    version: 1,
  };
  await putProfile(sub, profile);
  return profile;
}

export async function listProfiles(sub: string): Promise<Profile[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": PK.user(sub), ":sk": "profile#" },
    }),
  );
  const items = (res.Items ?? []).map(stripKeys<Profile>);
  return items.map((p) => ({
    ...p,
    ownerSub: p.ownerSub ?? sub,
    sharedWith: p.sharedWith ?? [],
    version: p.version ?? 1,
  })).sort((a, b) => a.createdAt - b.createdAt);
}

export async function putProfile(ownerSub: string, profile: Profile): Promise<Profile> {
  // Dedup sharedWith by sub (keep last entry per sub) — makes concurrent
  // first-time-accept races harmless (no duplicate entries / notifications).
  const bySub = new Map<string, ProfileShareEntry>();
  for (const e of profile.sharedWith ?? []) bySub.set(e.sub, e);
  const enriched: Profile = {
    ...profile,
    ownerSub: profile.ownerSub ?? ownerSub,
    sharedWith: [...bySub.values()],
    version: profile.version ?? 1,
  };
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK.user(ownerSub), sk: SK.profile(profile.id), ...enriched },
    }),
  );
  // Profile-meta sentinel for schedule-sync ownerSub lookup (no GSI).
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK.profile(profile.id),
        sk: "meta",
        ownerSub: enriched.ownerSub,
        profileId: profile.id,
      },
    }),
  );
  return enriched;
}

/**
 * Deletes a profile and ALL associated data:
 * - All items under profile#<id> partition (reminders, logs, notified, meta)
 * - Activities (diário) for this profile, stored in the owner's partition
 * - The profile metadata item at user#<ownerSub>/profile#<id>
 * - Share-link records for every member in sharedWith
 *
 * @param ownerSub  The ownerSub of the profile (NOT necessarily the caller).
 * @param profileId The profile id to delete.
 */
export async function deleteProfileCascade(ownerSub: string, profileId: string): Promise<void> {
  // 1. Fetch the profile to get sharedWith members.
  const profileRes = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: PK.user(ownerSub), sk: SK.profile(profileId) },
    }),
  );
  const sharedWith: Array<{ sub: string }> = profileRes.Item
    ? ((profileRes.Item.sharedWith as Array<{ sub: string }>) ?? [])
    : [];

  // 2. Query and delete every item under profile#<id> (reminders, logs, notified, meta).
  let lek: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": PK.profile(profileId) },
        ExclusiveStartKey: lek,
      }),
    );
    for (const item of res.Items ?? []) {
      await doc.send(
        new DeleteCommand({
          TableName: TABLE,
          Key: { pk: item.pk, sk: item.sk },
        }),
      );
    }
    lek = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lek);

  // 2b. Delete activities (diário) for this profile from the owner's partition.
  const activities = await listAllActivities(ownerSub);
  for (const a of activities.filter((x) => x.profileId === profileId)) {
    await deleteActivity(ownerSub, a.date, a.id);
  }

  // 3. Delete the profile metadata at user#<ownerSub>/profile#<id>.
  await doc.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: PK.user(ownerSub), sk: SK.profile(profileId) },
    }),
  );

  // 4. Delete the share-link record for each shared member.
  for (const entry of sharedWith) {
    await deleteShareLink(entry.sub, ownerSub, profileId);
  }
}

export function pickProfileColor(existing: Profile[]): ProfileColor {
  const counts = new Map<ProfileColor, number>(PROFILE_COLORS.map((c) => [c, 0]));
  for (const p of existing) counts.set(p.color, (counts.get(p.color) ?? 0) + 1);
  let pick: ProfileColor = PROFILE_COLORS[0];
  let best = Infinity;
  for (const c of PROFILE_COLORS) {
    const n = counts.get(c) ?? 0;
    if (n < best) {
      best = n;
      pick = c;
    }
  }
  return pick;
}

export async function getConfig(sub: string): Promise<Config & { _registered?: boolean }> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.user(sub), sk: SK.config } }),
  );
  if (!res.Item) return { timezone: "America/Sao_Paulo" };
  return res.Item as Config & { _registered?: boolean };
}

export async function setConfig(sub: string, patch: Partial<Config>): Promise<Config> {
  const existing = await getConfig(sub);
  const merged = { ...existing, ...patch };
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK.user(sub), sk: SK.config, ...merged },
    }),
  );
  if (patch.chatId !== undefined) {
    await doc.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          pk: PK.users,
          sk: SK.userIndex(sub),
          sub,
          email: merged.email,
          hasChat: !!patch.chatId,
        },
      }),
    );
  }
  return merged;
}

/**
 * @deprecated Use listRemindersForProfile across listProfilesForUser instead.
 * Kept for migration script compatibility.
 */
export async function listReminders(sub: string): Promise<Reminder[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": PK.user(sub), ":sk": "reminder#" },
    }),
  );
  return (res.Items ?? []).map(stripKeys<Reminder>);
}

/**
 * @deprecated Use getReminderForProfile + findReminder walker instead.
 * Kept for migration script compatibility.
 */
export async function getReminder(sub: string, id: string): Promise<Reminder | null> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.user(sub), sk: SK.reminder(id) } }),
  );
  if (!res.Item) return null;
  return stripKeys<Reminder>(res.Item);
}

export async function putReminder(sub: string, reminder: Reminder): Promise<Reminder> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK.user(sub), sk: SK.reminder(reminder.id), ...reminder },
    }),
  );
  return reminder;
}

export async function setReminderStatus(
  sub: string,
  id: string,
  status: ReminderStatus,
): Promise<Reminder | null> {
  const existing = await getReminder(sub, id);
  if (!existing) return null;
  const updated: Reminder = { ...existing, status };
  await putReminder(sub, updated);
  return updated;
}

export async function deleteReminder(sub: string, id: string): Promise<void> {
  await doc.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: PK.user(sub), sk: SK.reminder(id) },
    }),
  );
}

export async function listActivities(sub: string, date: string): Promise<Activity[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": PK.user(sub), ":sk": `activity#${date}#` },
    }),
  );
  return (res.Items ?? [])
    .map(stripKeys<Activity>)
    .sort((a, b) => activityTime(a) - activityTime(b));
}

export async function listAllActivities(sub: string): Promise<Activity[]> {
  // Paginate — a single QueryCommand caps at 1MB, so without the loop
  // activities beyond the first page leak (e.g. on deleteProfileCascade).
  const out: Activity[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: { ":pk": PK.user(sub), ":sk": "activity#" },
        ExclusiveStartKey: lek,
      }),
    );
    for (const it of res.Items ?? []) out.push(stripKeys<Activity>(it));
    lek = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lek);
  return out;
}

export async function getActivity(
  sub: string,
  date: string,
  id: string,
): Promise<Activity | null> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.user(sub), sk: SK.activity(date, id) } }),
  );
  if (!res.Item) return null;
  return stripKeys<Activity>(res.Item);
}

export async function putActivity(sub: string, activity: Activity): Promise<Activity> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK.user(sub), sk: SK.activity(activity.date, activity.id), ...activity },
    }),
  );
  return activity;
}

export async function deleteActivity(sub: string, date: string, id: string): Promise<void> {
  await doc.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: PK.user(sub), sk: SK.activity(date, id) },
    }),
  );
}

/**
 * Sonecas em andamento (sem endedAt) de todos os perfis. Consulta o bucket de
 * hoje e o de ontem — uma soneca pode ter começado antes da meia-noite — e
 * deduplica por id. Mais recentes primeiro.
 */
export async function listOpenNaps(sub: string, tz: string): Promise<NapActivity[]> {
  const today = nowInTz(tz).date;
  const buckets = [today, addDays(today, -1)];
  const open: NapActivity[] = [];
  const seen = new Set<string>();
  for (const date of buckets) {
    for (const a of await listActivities(sub, date)) {
      if (isOngoingNap(a) && !seen.has(a.id)) {
        seen.add(a.id);
        open.push(a);
      }
    }
  }
  return open.sort((a, b) => b.startedAt - a.startedAt);
}

/** Soneca em andamento de um perfil específico, se houver. */
export async function findOpenNap(
  sub: string,
  profileId: string,
  tz: string,
): Promise<NapActivity | null> {
  const open = await listOpenNaps(sub, tz);
  return open.find((n) => n.profileId === profileId) ?? null;
}

/**
 * @deprecated Use getLogForProfile across listProfilesForUser instead.
 * Kept for migration script compatibility.
 */
export async function getLog(sub: string, date: string): Promise<DayLog> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.user(sub), sk: SK.log(date) } }),
  );
  if (!res.Item) return {};
  const log = { ...(res.Item as Record<string, unknown>) };
  delete log.pk;
  delete log.sk;
  return log as DayLog;
}

export async function setLogEntry(
  sub: string,
  date: string,
  slotKey: string,
  taken: boolean,
): Promise<DayLog> {
  const log = await getLog(sub, date);
  if (taken) log[slotKey] = { taken: true, takenAt: Date.now() };
  else delete log[slotKey];
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK.user(sub),
        sk: SK.log(date),
        ...log,
        ttl: Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60,
      },
    }),
  );
  return log;
}

export async function wasNotified(sub: string, date: string, slotKey: string): Promise<boolean> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.user(sub), sk: SK.notified(date) } }),
  );
  const keys = (res.Item?.keys ?? []) as string[];
  return keys.includes(slotKey);
}

export async function getNotifiedKeys(sub: string, date: string): Promise<Set<string>> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.user(sub), sk: SK.notified(date) } }),
  );
  const keys = (res.Item?.keys ?? []) as string[];
  return new Set(keys);
}

/**
 * Atomic check-and-mark. Returns true if the caller won the race (we should
 * fire the notification). Returns false if someone else already marked it
 * (skip — avoid duplicate Telegram messages on Lambda retry).
 */
export async function markNotified(
  sub: string,
  date: string,
  slotKey: string,
): Promise<boolean> {
  const ttl = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
  try {
    await doc.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk: PK.user(sub), sk: SK.notified(date) },
        UpdateExpression:
          "SET #keys = list_append(if_not_exists(#keys, :empty), :new), #ttl = :ttl",
        ConditionExpression:
          "attribute_not_exists(#keys) OR NOT contains(#keys, :slotKey)",
        ExpressionAttributeNames: { "#keys": "keys", "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":empty": [] as string[],
          ":new": [slotKey],
          ":slotKey": slotKey,
          ":ttl": ttl,
        },
      }),
    );
    return true;
  } catch (e) {
    if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
      return false;
    }
    throw e;
  }
}

export async function listAllUsers(): Promise<{ sub: string; email?: string; hasChat?: boolean }[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": PK.users, ":sk": "user#" },
    }),
  );
  return (res.Items ?? []).map((it) => ({
    sub: it.sub as string,
    email: it.email as string | undefined,
    hasChat: it.hasChat as boolean | undefined,
  }));
}

export async function putPairToken(token: string, sub: string, ttlSeconds: number): Promise<void> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK.pair(token),
        sk: SK.pair,
        kind: "telegram",
        sub,
        ttl: Math.floor(Date.now() / 1000) + ttlSeconds,
      },
    }),
  );
}

/**
 * Atomic consume — only one caller wins. Returns the sub if we won (the token
 * was valid and is now gone), or null if expired/missing/already-consumed.
 *
 * The kind discriminator namespaces Telegram pair tokens from generic sharing
 * tokens (both live at pair#<token>/pair). `attribute_not_exists(#kind)` keeps
 * backward-compat with pre-existing prod pair tokens written without `kind`.
 */
export async function consumePairToken(token: string): Promise<string | null> {
  try {
    const res = await doc.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { pk: PK.pair(token), sk: SK.pair },
        ConditionExpression:
          "attribute_exists(pk) AND (attribute_not_exists(#kind) OR #kind = :kind) AND (attribute_not_exists(#ttl) OR #ttl > :now)",
        ExpressionAttributeNames: { "#kind": "kind", "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":kind": "telegram",
          ":now": Math.floor(Date.now() / 1000),
        },
        ReturnValues: "ALL_OLD",
      }),
    );
    return (res.Attributes?.sub as string) ?? null;
  } catch (e) {
    if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
      return null;
    }
    throw e;
  }
}

// ── Generic (sharing) token helpers ─────────────────────────────────────────
// These are distinct from putPairToken/consumePairToken (Telegram pairing) so
// that the Telegram flow is not affected by the sharing token changes.

export async function putGenericToken(token: string, payloadJson: string, ttlSeconds: number): Promise<void> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK.pair(token),
        sk: SK.pair,
        kind: "generic",
        payload: payloadJson,
        ttl: Math.floor(Date.now() / 1000) + ttlSeconds,
      },
    }),
  );
}

export async function consumeGenericToken(token: string): Promise<string | null> {
  try {
    const res = await doc.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { pk: PK.pair(token), sk: SK.pair },
        ConditionExpression:
          "attribute_exists(pk) AND #kind = :kind AND (attribute_not_exists(#ttl) OR #ttl > :now)",
        ExpressionAttributeNames: { "#kind": "kind", "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":kind": "generic",
          ":now": Math.floor(Date.now() / 1000),
        },
        ReturnValues: "ALL_OLD",
      }),
    );
    return (res.Attributes?.payload as string) ?? null;
  } catch (e) {
    if ((e as { name?: string }).name === "ConditionalCheckFailedException") return null;
    throw e;
  }
}

export async function peekGenericToken(token: string): Promise<string | null> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.pair(token), sk: SK.pair } }),
  );
  const ttl = res.Item?.ttl as number | undefined;
  if (!res.Item || res.Item.kind !== "generic") return null;
  if (ttl && ttl <= Math.floor(Date.now() / 1000)) return null;
  return (res.Item.payload as string) ?? null;
}

export async function setChatMapping(chatId: number, sub: string): Promise<void> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK.chat(chatId), sk: SK.chat, sub },
    }),
  );
}

export async function getChatOwner(chatId: number): Promise<string | null> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.chat(chatId), sk: SK.chat } }),
  );
  return (res.Item?.sub as string) ?? null;
}

/**
 * Wipes everything for a user — shares, owned profiles (cascade), partner
 * records, config, chat mapping, and the users index entry.
 * For LGPD account deletion.
 */
export async function deleteUserCascade(sub: string): Promise<{ items: number }> {
  let totalDeleted = 0;

  // 0) Detach caller from all profiles they access as caregiver/partner.
  //    Remove their share-link and remove them from the owner's sharedWith.
  const links = await listShareLinks(sub);
  for (const l of links) {
    await deleteShareLink(sub, l.ownerSub, l.profileId);
    totalDeleted++;
    const ownerRes = await doc.send(
      new GetCommand({
        TableName: TABLE,
        Key: { pk: PK.user(l.ownerSub), sk: SK.profile(l.profileId) },
      }),
    );
    if (ownerRes.Item) {
      const profile = stripKeys<Profile>(ownerRes.Item);
      await putProfile(l.ownerSub, {
        ...profile,
        sharedWith: profile.sharedWith.filter((e) => e.sub !== sub),
        version: profile.version + 1,
      });
    }
  }

  // 1) Delete every owned profile — cascades reminders/logs/notified + member links.
  const ownedProfiles = await listProfiles(sub);
  for (const p of ownedProfiles) {
    await deleteProfileCascade(sub, p.id);
  }
  totalDeleted += ownedProfiles.length;

  // 2) Partner cleanup on both sides.
  const partner = await getPartner(sub);
  if (partner) {
    await deletePartner(sub);
    await deletePartner(partner.partnerSub);
    totalDeleted += 2;
  }

  // 3) Sweep remaining user# partition items (config, share links, etc.).
  let chatIdToCleanup: number | undefined;
  let lek: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": PK.user(sub) },
        ExclusiveStartKey: lek,
      }),
    );
    const items = res.Items ?? [];
    for (const it of items) {
      if (it.sk === SK.config && typeof it.chatId === "number") {
        chatIdToCleanup = it.chatId as number;
      }
      await doc.send(
        new DeleteCommand({
          TableName: TABLE,
          Key: { pk: it.pk, sk: it.sk },
        }),
      );
      totalDeleted++;
    }
    lek = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lek);

  // 4) Delete chat mapping if present.
  if (chatIdToCleanup !== undefined) {
    await doc.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { pk: PK.chat(chatIdToCleanup), sk: SK.chat },
      }),
    );
    totalDeleted++;
  }

  // 5) Remove from global users index.
  await doc.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: PK.users, sk: SK.userIndex(sub) },
    }),
  );
  totalDeleted++;

  return { items: totalDeleted };
}

function stripKeys<T>(item: Record<string, unknown>): T {
  const copy = { ...item };
  delete copy.pk;
  delete copy.sk;
  return copy as T;
}

// ── Profile-scoped reminder helpers ─────────────────────────────────────────

export async function listRemindersForProfile(profileId: string): Promise<Reminder[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": PK.profile(profileId), ":sk": "reminder#" },
    }),
  );
  return (res.Items ?? []).map(stripKeys<Reminder>);
}

export async function getReminderForProfile(profileId: string, id: string): Promise<Reminder | null> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.profile(profileId), sk: SK.reminder(id) } }),
  );
  return res.Item ? stripKeys<Reminder>(res.Item) : null;
}

export async function putReminderForProfile(reminder: Reminder): Promise<Reminder> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK.profile(reminder.profileId), sk: SK.reminder(reminder.id), ...reminder },
    }),
  );
  return reminder;
}

export async function deleteReminderForProfile(profileId: string, id: string): Promise<void> {
  await doc.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: PK.profile(profileId), sk: SK.reminder(id) },
    }),
  );
}

// ── Profile-scoped log helpers ───────────────────────────────────────────────

export async function getLogForProfile(profileId: string, date: string): Promise<DayLog> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.profile(profileId), sk: SK.log(date) } }),
  );
  if (!res.Item) return {};
  const log = { ...(res.Item as Record<string, unknown>) };
  delete log.pk; delete log.sk; delete log.ttl;
  return log as DayLog;
}

export async function setLogEntryForProfile(
  profileId: string,
  date: string,
  slotKey: string,
  taken: boolean,
  takenBy: string,
  takenByName?: string,
): Promise<DayLog> {
  const log = await getLogForProfile(profileId, date);
  if (taken) log[slotKey] = { taken: true, takenAt: Date.now(), takenBy, ...(takenByName ? { takenByName } : {}) };
  else delete log[slotKey];
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK.profile(profileId),
        sk: SK.log(date),
        ...log,
        ttl: Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60,
      },
    }),
  );
  return log;
}

// ── Profile-scoped notified helpers ─────────────────────────────────────────

export async function getNotifiedKeysForProfile(profileId: string, date: string): Promise<Set<string>> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.profile(profileId), sk: SK.notified(date) } }),
  );
  const keys = (res.Item?.keys ?? []) as string[];
  return new Set(keys);
}

export async function markNotifiedForProfile(
  profileId: string,
  date: string,
  slotKey: string,
): Promise<boolean> {
  const ttl = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
  try {
    await doc.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk: PK.profile(profileId), sk: SK.notified(date) },
        UpdateExpression: "SET #keys = list_append(if_not_exists(#keys, :empty), :new), #ttl = :ttl",
        ConditionExpression: "attribute_not_exists(#keys) OR NOT contains(#keys, :slotKey)",
        ExpressionAttributeNames: { "#keys": "keys", "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":empty": [] as string[],
          ":new": [slotKey],
          ":slotKey": slotKey,
          ":ttl": ttl,
        },
      }),
    );
    return true;
  } catch (e) {
    if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
      return false;
    }
    throw e;
  }
}

// ── Share link helpers ───────────────────────────────────────────────────────

export type ProfileWithAccess = {
  profile: Profile;
  accessRole: "owner" | "partner" | "caregiver";
};

export async function listShareLinks(viewerSub: string): Promise<ProfileShareLink[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": PK.user(viewerSub), ":sk": "shared#" },
    }),
  );
  return (res.Items ?? []).map((it) => ({
    ownerSub: it.ownerSub as string,
    profileId: it.profileId as string,
    role: it.role as ProfileShareRole,
    addedAt: it.addedAt as number,
  }));
}

export async function putShareLink(viewerSub: string, link: ProfileShareLink): Promise<void> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK.user(viewerSub),
        sk: SK.shareLink(link.ownerSub, link.profileId),
        ...link,
      },
    }),
  );
}

export async function deleteShareLink(viewerSub: string, ownerSub: string, profileId: string): Promise<void> {
  await doc.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: PK.user(viewerSub), sk: SK.shareLink(ownerSub, profileId) },
    }),
  );
}

export async function listProfilesForUser(sub: string): Promise<ProfileWithAccess[]> {
  const [own, links] = await Promise.all([listProfiles(sub), listShareLinks(sub)]);
  const ownEntries: ProfileWithAccess[] = own.map((p) => ({ profile: p, accessRole: "owner" }));
  const fetched = await Promise.all(
    links.map(async (l) => {
      const res = await doc.send(
        new GetCommand({
          TableName: TABLE,
          Key: { pk: PK.user(l.ownerSub), sk: SK.profile(l.profileId) },
        }),
      );
      if (!res.Item) return null;
      const profile = stripKeys<Profile>(res.Item);
      return {
        profile: {
          ...profile,
          ownerSub: profile.ownerSub ?? l.ownerSub,
          sharedWith: profile.sharedWith ?? [],
          version: profile.version ?? 1,
        },
        accessRole: l.role,
      } as ProfileWithAccess;
    }),
  );
  return [...ownEntries, ...fetched.filter((x): x is ProfileWithAccess => x !== null)];
}

// ── Partner record CRUD ──────────────────────────────────────────────────────

export async function setPartner(sub: string, p: PartnerRecord): Promise<void> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK.user(sub), sk: SK.partner, ...p },
    }),
  );
}

export async function getPartner(sub: string): Promise<PartnerRecord | null> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.user(sub), sk: SK.partner } }),
  );
  if (!res.Item) return null;
  const it = res.Item;
  return {
    partnerSub: it.partnerSub as string,
    partnerEmail: it.partnerEmail as string | undefined,
    partnerName: it.partnerName as string | undefined,
    since: it.since as number,
  };
}

export async function deletePartner(sub: string): Promise<void> {
  await doc.send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: PK.user(sub), sk: SK.partner } }),
  );
}

export async function setReminderStatusForProfile(
  profileId: string,
  id: string,
  status: ReminderStatus,
): Promise<Reminder | null> {
  const existing = await getReminderForProfile(profileId, id);
  if (!existing) return null;
  const updated: Reminder = { ...existing, status };
  await putReminderForProfile(updated);
  return updated;
}

export const _internal = { PK, SK, doc, TABLE };
