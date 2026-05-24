import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
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
  Profile,
  ProfileColor,
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
  pair: (token: string) => `pair#${token}`,
  chat: (chatId: number) => `chat#${chatId}`,
  users: "users",
};
const SK = {
  config: "config",
  reminder: (id: string) => `reminder#${id}`,
  profile: (id: string) => `profile#${id}`,
  log: (date: string) => `log#${date}`,
  activity: (date: string, id: string) => `activity#${date}#${id}`,
  notified: (date: string) => `notified#${date}`,
  pair: "pair",
  chat: "chat",
  userIndex: (sub: string) => `user#${sub}`,
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
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putProfile(sub: string, profile: Profile): Promise<Profile> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK.user(sub), sk: SK.profile(profile.id), ...profile },
    }),
  );
  return profile;
}

export async function deleteProfileCascade(sub: string, profileId: string): Promise<void> {
  const reminders = await listReminders(sub);
  const orphaned = reminders.filter((r) => r.profileId === profileId);
  for (const r of orphaned) await deleteReminder(sub, r.id);
  const activities = await listAllActivities(sub);
  for (const a of activities.filter((x) => x.profileId === profileId)) {
    await deleteActivity(sub, a.date, a.id);
  }
  await doc.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: PK.user(sub), sk: SK.profile(profileId) },
    }),
  );
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
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": PK.user(sub), ":sk": "activity#" },
    }),
  );
  return (res.Items ?? []).map(stripKeys<Activity>);
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
        sub,
        ttl: Math.floor(Date.now() / 1000) + ttlSeconds,
      },
    }),
  );
}

/**
 * Atomic consume — only one caller wins. Returns the sub if we won (the token
 * was valid and is now gone), or null if expired/missing/already-consumed.
 */
export async function consumePairToken(token: string): Promise<string | null> {
  try {
    const res = await doc.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { pk: PK.pair(token), sk: SK.pair },
        ConditionExpression:
          "attribute_exists(pk) AND (attribute_not_exists(#ttl) OR #ttl > :now)",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: { ":now": Math.floor(Date.now() / 1000) },
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
 * Wipes everything for a user — reminders, profiles, config, logs, notified,
 * chat mapping, and the users index entry. For LGPD account deletion.
 */
export async function deleteUserCascade(sub: string): Promise<{ items: number }> {
  let chatIdToCleanup: number | undefined;
  let lek: Record<string, unknown> | undefined;
  let totalDeleted = 0;
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
      if (it.sk === "config" && typeof it.chatId === "number") {
        chatIdToCleanup = it.chatId as number;
      }
    }
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      await doc.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE]: batch.map((it) => ({
              DeleteRequest: { Key: { pk: it.pk, sk: it.sk } },
            })),
          },
        }),
      );
    }
    totalDeleted += items.length;
    lek = res.LastEvaluatedKey;
  } while (lek);

  if (chatIdToCleanup !== undefined) {
    await doc.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { pk: PK.chat(chatIdToCleanup), sk: SK.chat },
      }),
    );
  }

  await doc.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: PK.users, sk: SK.userIndex(sub) },
    }),
  );

  return { items: totalDeleted };
}

function stripKeys<T>(item: Record<string, unknown>): T {
  const copy = { ...item };
  delete copy.pk;
  delete copy.sk;
  return copy as T;
}
