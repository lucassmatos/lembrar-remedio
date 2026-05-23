import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { nanoid } from "nanoid";
import type { Config, DayLog, Medication, Profile, ProfileColor } from "./types";
import { PROFILE_COLORS } from "./types";

const TABLE = process.env.DDB_TABLE_NAME || "lembrar-remedio";
const REGION = process.env.LR_AWS_REGION || process.env.AWS_REGION || "us-east-1";

// Só usa creds estáticas se LR_AWS_* estiverem setados (caso Vercel).
// Em Lambda, deixa o SDK usar o default credential provider chain (role da Lambda).
const lrAccessKey = process.env.LR_AWS_ACCESS_KEY_ID;
const lrSecretKey = process.env.LR_AWS_SECRET_ACCESS_KEY;

const raw = new DynamoDBClient({
  region: REGION,
  credentials: lrAccessKey && lrSecretKey
    ? { accessKeyId: lrAccessKey, secretAccessKey: lrSecretKey }
    : undefined,
});
const doc = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
});

const PK = {
  user: (sub: string) => `user#${sub}`,
  pair: (token: string) => `pair#${token}`,
  chat: (chatId: number) => `chat#${chatId}`,
  users: "users",
};
const SK = {
  config: "config",
  med: (id: string) => `med#${id}`,
  profile: (id: string) => `profile#${id}`,
  log: (date: string) => `log#${date}`,
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
  const meds = await listMeds(sub);
  const orphaned = meds.filter((m) => m.profileId === profileId);
  for (const m of orphaned) await deleteMed(sub, m.id);
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

export async function listMeds(sub: string): Promise<Medication[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": PK.user(sub), ":sk": "med#" },
    }),
  );
  const meds = (res.Items ?? []).map(stripKeys<Medication>);
  const needsBackfill = meds.some((m) => !m.profileId);
  if (!needsBackfill) return meds;
  const def = await ensureDefaultProfile(sub);
  const repaired: Medication[] = [];
  for (const m of meds) {
    if (m.profileId) {
      repaired.push(m);
      continue;
    }
    const fixed = { ...m, profileId: def.id };
    await putMed(sub, fixed);
    repaired.push(fixed);
  }
  return repaired;
}

export async function putMed(sub: string, med: Medication): Promise<Medication> {
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK.user(sub), sk: SK.med(med.id), ...med },
    }),
  );
  return med;
}

export async function deleteMed(sub: string, id: string): Promise<void> {
  await doc.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: PK.user(sub), sk: SK.med(id) },
    }),
  );
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

export async function markNotified(sub: string, date: string, slotKey: string): Promise<void> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.user(sub), sk: SK.notified(date) } }),
  );
  const keys = new Set<string>(((res.Item?.keys ?? []) as string[]));
  keys.add(slotKey);
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK.user(sub),
        sk: SK.notified(date),
        keys: Array.from(keys),
        ttl: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60,
      },
    }),
  );
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

export async function consumePairToken(token: string): Promise<string | null> {
  const res = await doc.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK.pair(token), sk: SK.pair } }),
  );
  if (!res.Item) return null;
  const ttl = res.Item.ttl as number | undefined;
  if (ttl && ttl * 1000 < Date.now()) return null;
  await doc.send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: PK.pair(token), sk: SK.pair } }),
  );
  return res.Item.sub as string;
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

function stripKeys<T>(item: Record<string, unknown>): T {
  const copy = { ...item };
  delete copy.pk;
  delete copy.sk;
  return copy as T;
}
