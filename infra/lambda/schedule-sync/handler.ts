import type { DynamoDBStreamEvent, DynamoDBRecord } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { updateProfileSchedule, deleteProfileSchedule } from "./profile-schedule";
import { deleteBirthdaySchedule, upsertBirthdaySchedule } from "./birthday-schedule";
import { _internal } from "../../../lib/ddb";

type ProfileDecision =
  | { kind: "profile"; action: "update"; profileId: string }
  | { kind: "profile"; action: "delete"; profileId: string };

type BirthdayDecision =
  | { kind: "birthday"; action: "upsert"; sub: string; tz: string }
  | { kind: "birthday"; action: "delete"; sub: string };

type Decision = ProfileDecision | BirthdayDecision | null;

function decide(record: DynamoDBRecord): Decision {
  const keys = record.dynamodb?.Keys;
  const pk = keys?.pk?.S;
  const sk = keys?.sk?.S;
  if (!pk || !sk) return null;

  // Profile partition: rotinas de medicação (next-dose).
  if (pk.startsWith("profile#")) {
    const profileId = pk.slice("profile#".length);
    if (sk.startsWith("reminder#")) return { kind: "profile", action: "update", profileId };
    if (sk === "meta" && record.eventName === "REMOVE") {
      return { kind: "profile", action: "delete", profileId };
    }
    return null;
  }

  // User config: cria/atualiza/apaga o schedule diário de aniversários.
  // Tz pode mudar — re-cria pra refletir a hora local do usuário.
  if (pk.startsWith("user#") && sk === "config") {
    const sub = pk.slice("user#".length);
    if (record.eventName === "REMOVE") return { kind: "birthday", action: "delete", sub };
    // INSERT ou MODIFY: pega timezone do NewImage e faz upsert.
    const newImage = record.dynamodb?.NewImage;
    const tz = newImage?.timezone?.S;
    if (!tz) return null; // sem tz, nada a fazer
    return { kind: "birthday", action: "upsert", sub, tz };
  }

  return null;
}

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  // Coalesce a batch. Delete vence update no mesmo recurso.
  const profileUpdates = new Set<string>();
  const profileDeletes = new Set<string>();
  const birthdayUpserts = new Map<string, string>(); // sub → tz (último ganha)
  const birthdayDeletes = new Set<string>();

  for (const record of event.Records) {
    const d = decide(record);
    if (!d) continue;
    if (d.kind === "profile") {
      if (d.action === "delete") profileDeletes.add(d.profileId);
      else profileUpdates.add(d.profileId);
    } else {
      if (d.action === "delete") birthdayDeletes.add(d.sub);
      else birthdayUpserts.set(d.sub, d.tz);
    }
  }
  for (const profileId of profileDeletes) profileUpdates.delete(profileId);
  for (const sub of birthdayDeletes) birthdayUpserts.delete(sub);

  for (const profileId of profileDeletes) {
    try {
      const removed = await deleteProfileSchedule(profileId);
      console.log("profile schedule deleted", { profileId, removed });
    } catch (e) {
      console.error("failed to delete profile schedule", { profileId }, e);
      throw e;
    }
  }

  for (const profileId of profileUpdates) {
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

  for (const sub of birthdayDeletes) {
    try {
      const removed = await deleteBirthdaySchedule(sub);
      console.log("birthday schedule deleted", { sub, removed });
    } catch (e) {
      console.error("failed to delete birthday schedule", { sub }, e);
      throw e;
    }
  }

  for (const [sub, tz] of birthdayUpserts) {
    try {
      const action = await upsertBirthdaySchedule(sub, tz);
      console.log("birthday schedule synced", { sub, tz, action });
    } catch (e) {
      console.error("failed to sync birthday schedule", { sub, tz }, e);
      throw e;
    }
  }
}
