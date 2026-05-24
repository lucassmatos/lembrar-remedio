import type { DynamoDBStreamEvent, DynamoDBRecord } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { updateProfileSchedule, deleteProfileSchedule } from "./profile-schedule";
import { _internal } from "../../../lib/ddb";

type Decision =
  | { action: "update"; profileId: string }
  | { action: "delete"; profileId: string }
  | null;

function decide(record: DynamoDBRecord): Decision {
  const keys = record.dynamodb?.Keys;
  const pk = keys?.pk?.S;
  const sk = keys?.sk?.S;
  if (!pk || !sk) return null;
  if (!pk.startsWith("profile#")) return null;
  const profileId = pk.slice("profile#".length);

  // Only changes that shift next-dose calculation. Skip log#, notified#.
  if (sk.startsWith("reminder#")) return { action: "update", profileId };
  if (sk === "meta" && record.eventName === "REMOVE") {
    // Profile was deleted — remove its schedule.
    return { action: "delete", profileId };
  }
  return null;
}

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  // Coalesce a batch into one operation per profileId. Delete wins over update.
  const updates = new Set<string>();
  const deletes = new Set<string>();

  for (const record of event.Records) {
    const d = decide(record);
    if (!d) continue;
    if (d.action === "delete") deletes.add(d.profileId);
    else updates.add(d.profileId);
  }
  for (const profileId of deletes) updates.delete(profileId);

  for (const profileId of deletes) {
    try {
      const removed = await deleteProfileSchedule(profileId);
      console.log("profile schedule deleted", { profileId, removed });
    } catch (e) {
      console.error("failed to delete profile schedule", { profileId }, e);
      throw e;
    }
  }

  for (const profileId of updates) {
    try {
      // Look up ownerSub from the profile#<id>/meta sentinel.
      const { PK, doc, TABLE } = _internal;
      const metaRes = await doc.send(
        new GetCommand({
          TableName: TABLE,
          Key: { pk: PK.profile(profileId), sk: "meta" },
        }),
      );
      if (!metaRes.Item) {
        // meta is gone — profile was deleted in a race; delete schedule instead.
        console.log("profile meta not found, deleting schedule", { profileId });
        await deleteProfileSchedule(profileId);
        continue;
      }
      const ownerSub = metaRes.Item.ownerSub as string;
      const result = await updateProfileSchedule({ profileId, ownerSub });
      console.log("profile schedule synced", { profileId, ownerSub, ...result });
    } catch (e) {
      console.error("failed to sync profile schedule", { profileId }, e);
      throw e;
    }
  }
}
