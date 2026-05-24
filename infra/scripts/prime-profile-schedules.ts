// Prime per-profile EventBridge schedules after the profile-scoped migration.
//
// After migrating reminders into the profile#<id> partition, existing profiles
// have NO lr-profile-<id> schedule until a reminder changes (the schedule-sync
// Lambda only reacts to live DDB stream events). This one-shot re-puts every
// reminder, which emits a stream MODIFY event that the (now deployed)
// schedule-sync Lambda turns into a lr-profile-<id> schedule. Re-putting is
// idempotent — same data, just triggers the stream.
//
// Usage: AWS_PROFILE=lucas-pessoal AWS_REGION=us-east-1 npx tsx infra/scripts/prime-profile-schedules.ts [--dry-run]

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
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
  console.log(`Prime profile schedules dry=${DRY}`);

  // Find every profile via its meta sentinel (pk=profile#<id>, sk="meta").
  const profiles: string[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: "sk = :meta",
        ExpressionAttributeValues: { ":meta": "meta" },
        ExclusiveStartKey: lek,
      }),
    );
    for (const it of res.Items ?? []) {
      if (typeof it.profileId === "string") profiles.push(it.profileId);
    }
    lek = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lek);

  console.log(`Found ${profiles.length} profiles`);

  let touched = 0;
  for (const profileId of profiles) {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: { ":pk": `profile#${profileId}`, ":sk": "reminder#" },
      }),
    );
    const reminders = res.Items ?? [];
    if (reminders.length === 0) {
      console.log(`[${profileId}] no reminders, skipping`);
      continue;
    }
    // Re-put one reminder to emit a stream event for this profile.
    const r = reminders[0];
    if (DRY) {
      console.log(`[${profileId}] would re-put reminder ${r.sk} to trigger schedule-sync`);
    } else {
      await doc.send(new PutCommand({ TableName: TABLE, Item: r }));
      console.log(`[${profileId}] re-put ${r.sk} → schedule-sync will create lr-profile-${profileId}`);
      touched++;
    }
  }
  console.log(`done — ${touched} profiles primed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
