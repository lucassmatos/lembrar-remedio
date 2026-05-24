/**
 * One-off: migra items legacy `med#X` (modelo antigo "Medication") pro novo
 * formato `reminder#X` (kind=medication, schedule=daily-interval). Apaga os
 * med#X depois de copiar.
 *
 * Idempotente: se o reminder#X já existe pra um med#X, pula a cópia mas
 * ainda apaga o med#X.
 *
 * Rodar:
 *   cd infra
 *   AWS_REGION=us-east-1 DDB_TABLE_NAME=lembrar-remedio \
 *     npx ts-node scripts/migrate-med-to-reminder.ts
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.DDB_TABLE_NAME || "lembrar-remedio";
const REGION = process.env.AWS_REGION || "us-east-1";

const raw = new DynamoDBClient({ region: REGION });
const doc = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});

type LegacyMed = {
  pk: string;
  sk: string;
  id: string;
  name: string;
  intervalHours: number;
  startTime: string;
  profileId?: string;
  dosage?: string;
  times?: string[];
  startDate?: string;
  durationDays?: number;
  createdAt: number;
  _resyncAt?: number;
};

async function listAllUsers(): Promise<string[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": "users", ":sk": "user#" },
    }),
  );
  return (res.Items ?? []).map((it) => it.sub as string);
}

async function listLegacyMeds(sub: string): Promise<LegacyMed[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": `user#${sub}`, ":sk": "med#" },
    }),
  );
  return (res.Items ?? []) as LegacyMed[];
}

async function reminderExists(sub: string, id: string): Promise<boolean> {
  const res = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: `user#${sub}`, sk: `reminder#${id}` },
    }),
  );
  return !!res.Item;
}

async function main(): Promise<void> {
  const users = await listAllUsers();
  console.log(`→ ${users.length} usuários`);

  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalDeleted = 0;

  for (const sub of users) {
    const meds = await listLegacyMeds(sub);
    if (meds.length === 0) continue;
    console.log(`\nuser ${sub}: ${meds.length} legacy meds`);

    for (const med of meds) {
      const exists = await reminderExists(sub, med.id);
      if (!exists) {
        const reminder: Record<string, unknown> = {
          pk: med.pk,
          sk: `reminder#${med.id}`,
          id: med.id,
          kind: "medication",
          title: med.name,
          profileId: med.profileId,
          createdAt: med.createdAt,
          schedule: {
            type: "daily-interval",
            intervalHours: med.intervalHours,
            startTime: med.startTime,
            ...(med.times ? { times: med.times } : {}),
            ...(med.startDate ? { startDate: med.startDate } : {}),
            ...(med.durationDays ? { durationDays: med.durationDays } : {}),
          },
        };
        if (med.dosage) reminder.subtitle = med.dosage;
        await doc.send(new PutCommand({ TableName: TABLE, Item: reminder }));
        totalMigrated++;
        console.log(`  + ${med.id} (${med.name}) → reminder#${med.id}`);
      } else {
        totalSkipped++;
        console.log(`  ~ ${med.id} (${med.name}) já tem reminder, só apago o med`);
      }
      await doc.send(
        new DeleteCommand({ TableName: TABLE, Key: { pk: med.pk, sk: med.sk } }),
      );
      totalDeleted++;
    }
  }

  console.log("\n=== resumo ===");
  console.log(`reminders criados:    ${totalMigrated}`);
  console.log(`já existiam (skip):   ${totalSkipped}`);
  console.log(`med# apagados:        ${totalDeleted}`);
}

main().catch((e) => {
  console.error("falhou:", e);
  process.exit(1);
});
