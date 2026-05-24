import type { DynamoDBStreamEvent, DynamoDBRecord } from "aws-lambda";
import { updateUserSchedule, deleteUserSchedule } from "./user-schedule";

type Decision =
  | { action: "update"; sub: string }
  | { action: "delete"; sub: string }
  | null;

function decide(record: DynamoDBRecord): Decision {
  const keys = record.dynamodb?.Keys;
  const pk = keys?.pk?.S;
  const sk = keys?.sk?.S;
  if (!pk || !sk) return null;
  if (!pk.startsWith("user#")) return null;
  const sub = pk.slice("user#".length);

  // Only changes that shift next-dose calculation. Skip log#, notified#, profile#.
  if (sk.startsWith("reminder#")) return { action: "update", sub };
  if (sk === "config") {
    if (record.eventName === "REMOVE") return { action: "delete", sub };
    return { action: "update", sub };
  }
  return null;
}

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  // Coalesce a batch into one operation per (sub). Delete wins over update.
  const updates = new Set<string>();
  const deletes = new Set<string>();

  for (const record of event.Records) {
    const d = decide(record);
    if (!d) continue;
    if (d.action === "delete") deletes.add(d.sub);
    else updates.add(d.sub);
  }
  for (const sub of deletes) updates.delete(sub);

  for (const sub of deletes) {
    try {
      const removed = await deleteUserSchedule(sub);
      console.log("user schedule deleted", { sub, removed });
    } catch (e) {
      console.error("failed to delete user schedule", { sub }, e);
      throw e;
    }
  }
  for (const sub of updates) {
    try {
      const result = await updateUserSchedule(sub);
      console.log("user schedule synced", { sub, ...result });
    } catch (e) {
      console.error("failed to sync user schedule", { sub }, e);
      throw e;
    }
  }
}
