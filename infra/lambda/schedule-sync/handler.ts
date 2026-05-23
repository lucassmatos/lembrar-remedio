import type { DynamoDBStreamEvent, DynamoDBRecord } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { generateSlotsForMed } from "../../../lib/schedule";
import { listMeds, getConfig } from "../../../lib/ddb";
import type { Medication, Config } from "../../../lib/types";
import {
  syncMed,
  deleteAllForMed,
  deleteAllForUser,
  recreateForMed,
} from "./sync";

type Item = Record<string, unknown>;

function imageToObject(image?: { [k: string]: AttributeValue }): Item | null {
  if (!image) return null;
  return unmarshall(image) as Item;
}

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      await handleRecord(record);
    } catch (e) {
      console.error("record failed", record.eventID, e);
      throw e; // re-throw to let stream retry
    }
  }
}

async function handleRecord(record: DynamoDBRecord): Promise<void> {
  const keys = record.dynamodb?.Keys;
  if (!keys?.pk?.S || !keys.sk?.S) return;
  const pk = keys.pk.S;
  const sk = keys.sk.S;

  if (!pk.startsWith("user#")) return;
  const sub = pk.slice("user#".length);

  if (sk.startsWith("med#")) {
    const medId = sk.slice("med#".length);
    await handleMedChange(sub, medId, record);
    return;
  }

  if (sk === "config") {
    await handleConfigChange(sub, record);
    return;
  }
}

async function handleMedChange(
  sub: string,
  medId: string,
  record: DynamoDBRecord,
): Promise<void> {
  if (record.eventName === "REMOVE") {
    const deleted = await deleteAllForMed(sub, medId);
    console.log("med removed", { sub, medId, deleted: deleted.length });
    return;
  }

  const newImage = imageToObject(record.dynamodb?.NewImage as { [k: string]: AttributeValue } | undefined);
  if (!newImage) return;

  const med = newImage as unknown as Medication;
  const cfg = await getConfig(sub);
  const times = generateSlotsForMed(med);
  const result = await syncMed({
    sub,
    medId: med.id,
    times,
    timezone: cfg.timezone || "America/Sao_Paulo",
    enabled: !!cfg.chatId,
  });
  console.log("med synced", { sub, medId, times: times.length, ...result });
}

async function handleConfigChange(sub: string, record: DynamoDBRecord): Promise<void> {
  if (record.eventName === "REMOVE") {
    const deleted = await deleteAllForUser(sub);
    console.log("config removed, all schedules cleared", { sub, deleted: deleted.length });
    return;
  }

  const newImage = imageToObject(record.dynamodb?.NewImage as { [k: string]: AttributeValue } | undefined);
  const oldImage = imageToObject(record.dynamodb?.OldImage as { [k: string]: AttributeValue } | undefined);
  if (!newImage) return;

  const newCfg = newImage as unknown as Config;
  const oldCfg = oldImage as unknown as Config | null;

  const tzChanged = !!oldCfg && oldCfg.timezone !== newCfg.timezone;
  const chatChanged = (oldCfg?.chatId || null) !== (newCfg.chatId || null);

  if (!tzChanged && !chatChanged) return;

  // Need to recreate everything for this user
  const meds = await listMeds(sub);
  const enabled = !!newCfg.chatId;
  const tz = newCfg.timezone || "America/Sao_Paulo";
  for (const med of meds) {
    await recreateForMed(sub, med.id, generateSlotsForMed(med), tz, enabled);
  }
  console.log("user config synced", {
    sub,
    tzChanged,
    chatChanged,
    enabled,
    mediCount: meds.length,
  });
}
