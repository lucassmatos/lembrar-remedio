// Prime per-user birthday EventBridge schedules.
//
// O schedule diário de aniversários é criado quando user#<sub>/config dispara
// INSERT/MODIFY no stream do DDB. Usuários que já existem NÃO terão schedule
// até modificarem o config. Esse script re-grava o próprio config (mesmos
// dados) pra emitir MODIFY e o schedule-sync Lambda cria o schedule.
// Idempotente: re-put de dados idênticos.
//
// Usage: AWS_PROFILE=lucas-pessoal AWS_REGION=us-east-1 npx tsx infra/scripts/prime-birthday-schedules.ts [--dry-run]

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.DDB_TABLE_NAME || "lembrar-remedio";
const REGION = process.env.AWS_REGION || "us-east-1";
const DRY = process.argv.includes("--dry-run");

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

async function main() {
  console.log(`Prime birthday schedules dry=${DRY}`);

  // Lista todos os usuários via partição "users" (pk="users", sk="user#<sub>").
  const subs: string[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": "users" },
        ExclusiveStartKey: lek,
      }),
    );
    for (const it of res.Items ?? []) {
      if (typeof it.sub === "string") subs.push(it.sub);
    }
    lek = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lek);

  console.log(`Found ${subs.length} users`);

  let touched = 0;
  for (const sub of subs) {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND sk = :sk",
        ExpressionAttributeValues: { ":pk": `user#${sub}`, ":sk": "config" },
      }),
    );
    const cfg = res.Items?.[0];
    if (!cfg) {
      console.log(`[${sub}] no config, skipping`);
      continue;
    }
    if (!cfg.timezone) {
      console.log(`[${sub}] config sem timezone, skipping`);
      continue;
    }
    if (DRY) {
      console.log(`[${sub}] would re-put config (tz=${cfg.timezone}) to trigger schedule-sync`);
    } else {
      await doc.send(new PutCommand({ TableName: TABLE, Item: cfg }));
      console.log(`[${sub}] re-put config → schedule-sync vai criar lr-birthdays-${sub}`);
      touched++;
    }
  }
  console.log(`done — ${touched} users primed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
