// infra/scripts/migrate-profiles-to-shared.ts
//
// One-shot migration: move reminders, logs, notified from user# partition to
// profile# partition. Profile metadata stays under user#<ownerSub>.
//
// Usage: AWS_PROFILE=... npx -p tsx tsx infra/scripts/migrate-profiles-to-shared.ts [--dry-run] [--phase=copy|verify|delete|all]
//
// Idempotent: marks each user's config with migrationCopyDone / migrationDone
// timestamps. Safe to re-run.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

const DEFAULT_TABLE = process.env.DDB_TABLE_NAME || "lembrar-remedio";
const REGION = process.env.AWS_REGION || "us-east-1";

// Parse CLI flags only when run as a script (not when imported by tests).
const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const phaseArg = [...args].find((a) => a.startsWith("--phase="));
const DEFAULT_PHASE = (phaseArg?.split("=")[1] ?? "all") as Phase;

type Phase = "copy" | "verify" | "delete" | "all";

type MigrateUserOptions = {
  /** Injectable DDB doc client (for tests using dev-store). Defaults to real client. */
  doc?: DynamoDBDocumentClient;
  /** Table name override. Defaults to DDB_TABLE_NAME or "lembrar-remedio". */
  table?: string;
  /** Dry run — log what would change, no writes. */
  dryRun?: boolean;
  /** Which phase(s) to run. Defaults to "all". */
  phase?: Phase;
};

type Reminder = { id: string; profileId: string; [k: string]: unknown };
type Profile = { id: string; [k: string]: unknown };

function makeDefaultDoc(): DynamoDBDocumentClient {
  const raw = new DynamoDBClient({ region: REGION });
  return DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

// Lazy singleton for standalone runs.
let _defaultDoc: DynamoDBDocumentClient | undefined;
function getDefaultDoc(): DynamoDBDocumentClient {
  if (!_defaultDoc) _defaultDoc = makeDefaultDoc();
  return _defaultDoc;
}

function stripKeys(item: Record<string, unknown>): Record<string, unknown> {
  const { pk: _pk, sk: _sk, ...rest } = item as { pk?: unknown; sk?: unknown };
  return rest;
}

async function listAllUsers(
  doc: DynamoDBDocumentClient,
  table: string,
): Promise<string[]> {
  const out: string[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: { ":pk": "users", ":sk": "user#" },
        ExclusiveStartKey: lek,
      }),
    );
    for (const it of res.Items ?? []) out.push(it.sub as string);
    lek = res.LastEvaluatedKey;
  } while (lek);
  return out;
}

async function fetchUserPartition(
  sub: string,
  doc: DynamoDBDocumentClient,
  table: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": `user#${sub}` },
        ExclusiveStartKey: lek,
      }),
    );
    for (const it of res.Items ?? []) out.push(it);
    lek = res.LastEvaluatedKey;
  } while (lek);
  return out;
}

async function setMigrationFlag(
  sub: string,
  field: "migrationCopyDone" | "migrationDone",
  doc: DynamoDBDocumentClient,
  table: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  await doc.send(
    new UpdateCommand({
      TableName: table,
      Key: { pk: `user#${sub}`, sk: "config" },
      UpdateExpression: "SET #f = :now",
      ExpressionAttributeNames: { "#f": field },
      ExpressionAttributeValues: { ":now": Date.now() },
    }),
  );
}

async function getMigrationFlags(
  sub: string,
  doc: DynamoDBDocumentClient,
  table: string,
): Promise<{ copy?: number; done?: number }> {
  const res = await doc.send(
    new GetCommand({ TableName: table, Key: { pk: `user#${sub}`, sk: "config" } }),
  );
  return {
    copy: res.Item?.migrationCopyDone as number | undefined,
    done: res.Item?.migrationDone as number | undefined,
  };
}

async function safePut(
  item: Record<string, unknown>,
  doc: DynamoDBDocumentClient,
  table: string,
): Promise<void> {
  try {
    await doc.send(
      new PutCommand({
        TableName: table,
        Item: item,
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
  } catch (e) {
    const err = e as { name?: string };
    if (err.name === "ConditionalCheckFailedException") return; // already copied
    throw e;
  }
}

function splitLog(
  item: Record<string, unknown>,
  reminderToProfile: Map<string, string>,
): Map<string, Record<string, unknown>> {
  const byProfile = new Map<string, Record<string, unknown>>();
  for (const [key, val] of Object.entries(item)) {
    if (key === "pk" || key === "sk" || key === "ttl") continue;
    // slotKey format: "${reminderId}@HH:MM"
    const reminderId = key.split("@")[0];
    const profileId = reminderToProfile.get(reminderId);
    if (!profileId) continue; // entry refers to deleted reminder — discard
    let bucket = byProfile.get(profileId);
    if (!bucket) {
      bucket = {};
      byProfile.set(profileId, bucket);
    }
    bucket[key] = val;
  }
  return byProfile;
}

function splitNotified(
  item: Record<string, unknown>,
  reminderToProfile: Map<string, string>,
): Map<string, string[]> {
  const byProfile = new Map<string, string[]>();
  const keys = (item.keys as string[]) ?? [];
  for (const k of keys) {
    // slotKey or occurrenceKey, both start with reminderId
    const reminderId = k.split(/[@#]/)[0];
    const profileId = reminderToProfile.get(reminderId);
    if (!profileId) continue;
    const bucket = byProfile.get(profileId) ?? [];
    bucket.push(k);
    byProfile.set(profileId, bucket);
  }
  return byProfile;
}

/**
 * Migrate a single user's data from user# partition to profile# partition.
 * Idempotent — skips users already migrated via config flags.
 * Exported for use in tests (pass options.doc + options.table to inject dev-store).
 */
export async function migrateUser(
  sub: string,
  options?: MigrateUserOptions,
): Promise<void> {
  const doc = options?.doc ?? getDefaultDoc();
  const table = options?.table ?? DEFAULT_TABLE;
  const dryRun = options?.dryRun ?? false;
  const phase = options?.phase ?? DEFAULT_PHASE;

  const flags = await getMigrationFlags(sub, doc, table);
  if (flags.done) {
    console.log(`[${sub}] already done, skipping`);
    return;
  }

  console.log(`[${sub}] fetching partition`);
  const items = await fetchUserPartition(sub, doc, table);
  const reminders = items.filter(
    (it) => (it.sk as string).startsWith("reminder#"),
  ) as unknown as Reminder[];
  const logs = items.filter((it) => (it.sk as string).startsWith("log#"));
  const notified = items.filter((it) => (it.sk as string).startsWith("notified#"));
  const profiles = items.filter(
    (it) => (it.sk as string).startsWith("profile#"),
  ) as unknown as Profile[];

  const reminderToProfile = new Map<string, string>();
  for (const r of reminders) reminderToProfile.set(r.id, r.profileId);

  // ===== Phase: COPY =====
  if (phase === "copy" || phase === "all") {
    if (!flags.copy) {
      // Copy reminders
      for (const r of reminders) {
        const profileId = r.profileId;
        if (dryRun) {
          console.log(`[${sub}] would COPY reminder ${r.id} → profile#${profileId}`);
        } else {
          await safePut(
            { ...stripKeys(r), pk: `profile#${profileId}`, sk: `reminder#${r.id}` },
            doc,
            table,
          );
        }
      }

      // Copy logs (split by profile)
      for (const lg of logs) {
        const date = (lg.sk as string).slice("log#".length);
        const ttlVal = lg.ttl as number | undefined;
        const split = splitLog(lg, reminderToProfile);
        for (const [profileId, body] of split) {
          if (dryRun) {
            console.log(`[${sub}] would COPY log ${date} → profile#${profileId}`);
          } else {
            await safePut(
              {
                pk: `profile#${profileId}`,
                sk: `log#${date}`,
                ...body,
                ...(ttlVal !== undefined ? { ttl: ttlVal } : {}),
              },
              doc,
              table,
            );
          }
        }
      }

      // Copy notified (split by profile)
      for (const nf of notified) {
        const date = (nf.sk as string).slice("notified#".length);
        const ttlVal = nf.ttl as number | undefined;
        const split = splitNotified(nf, reminderToProfile);
        for (const [profileId, keys] of split) {
          if (dryRun) {
            console.log(
              `[${sub}] would COPY notified ${date} → profile#${profileId} (${keys.length} keys)`,
            );
          } else {
            await safePut(
              {
                pk: `profile#${profileId}`,
                sk: `notified#${date}`,
                keys,
                ...(ttlVal !== undefined ? { ttl: ttlVal } : {}),
              },
              doc,
              table,
            );
          }
        }
      }

      // Enrich profile metadata: ownerSub, sharedWith, version + write meta sentinel.
      for (const p of profiles) {
        if (dryRun) {
          console.log(
            `[${sub}] would UPDATE profile ${p.id} (ownerSub, sharedWith, version) + write meta sentinel`,
          );
        } else {
          // Update the profile record in user# partition.
          await doc.send(
            new UpdateCommand({
              TableName: table,
              Key: { pk: `user#${sub}`, sk: `profile#${p.id}` },
              UpdateExpression:
                "SET ownerSub = if_not_exists(ownerSub, :sub), sharedWith = if_not_exists(sharedWith, :empty), #v = if_not_exists(#v, :one)",
              ExpressionAttributeNames: { "#v": "version" },
              ExpressionAttributeValues: { ":sub": sub, ":empty": [], ":one": 1 },
            }),
          );
          // Write profile-meta sentinel in profile# partition.
          await doc.send(
            new PutCommand({
              TableName: table,
              Item: {
                pk: `profile#${p.id}`,
                sk: "meta",
                ownerSub: sub,
                profileId: p.id,
              },
            }),
          );
        }
      }

      await setMigrationFlag(sub, "migrationCopyDone", doc, table, dryRun);
      console.log(`[${sub}] COPY done`);
    } else {
      console.log(`[${sub}] COPY already done, skipping COPY phase`);
    }
  }

  // ===== Phase: VERIFY =====
  if (phase === "verify" || phase === "all") {
    for (const r of reminders) {
      const res = await doc.send(
        new GetCommand({
          TableName: table,
          Key: { pk: `profile#${r.profileId}`, sk: `reminder#${r.id}` },
        }),
      );
      if (!res.Item) {
        throw new Error(
          `[${sub}] VERIFY FAIL: reminder ${r.id} not found in profile#${r.profileId}`,
        );
      }
    }
    console.log(`[${sub}] VERIFY ok`);
  }

  // ===== Phase: DELETE =====
  if (phase === "delete" || phase === "all") {
    // Use sequential DeleteCommand — no BatchWrite required for a one-shot migration.
    for (const r of reminders) {
      if (dryRun) {
        console.log(`[${sub}] would DELETE user#${sub}/reminder#${r.id}`);
      } else {
        await doc.send(
          new DeleteCommand({
            TableName: table,
            Key: { pk: `user#${sub}`, sk: `reminder#${r.id}` },
          }),
        );
      }
    }
    for (const lg of logs) {
      if (dryRun) {
        console.log(`[${sub}] would DELETE user#${sub}/${lg.sk}`);
      } else {
        await doc.send(
          new DeleteCommand({
            TableName: table,
            Key: { pk: `user#${sub}`, sk: lg.sk as string },
          }),
        );
      }
    }
    for (const nf of notified) {
      if (dryRun) {
        console.log(`[${sub}] would DELETE user#${sub}/${nf.sk}`);
      } else {
        await doc.send(
          new DeleteCommand({
            TableName: table,
            Key: { pk: `user#${sub}`, sk: nf.sk as string },
          }),
        );
      }
    }
    if (!dryRun) {
      await setMigrationFlag(sub, "migrationDone", doc, table, dryRun);
    }
    console.log(`[${sub}] DELETE done`);
  }
}

async function main(): Promise<void> {
  const doc = getDefaultDoc();
  console.log(`Migration phase=${DEFAULT_PHASE} dry=${DRY}`);
  const users = await listAllUsers(doc, DEFAULT_TABLE);
  console.log(`Found ${users.length} users`);
  for (const sub of users) {
    try {
      await migrateUser(sub, { doc, table: DEFAULT_TABLE, dryRun: DRY, phase: DEFAULT_PHASE });
    } catch (e) {
      console.error(`[${sub}] ERROR`, e);
      throw e; // abort on first error
    }
  }
  console.log("done");
}

// Only run main() when invoked directly as a script, not when imported by tests.
if (process.argv[1]?.endsWith("migrate-profiles-to-shared.ts") ||
    process.argv[1]?.endsWith("migrate-profiles-to-shared.js")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
