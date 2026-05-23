import {
  getConfig,
  getLog,
  listMeds,
  listProfiles,
  markNotified,
  wasNotified,
} from "./ddb";
import { nowInTz, slotKey } from "./schedule";
import { escapeHtml, sendMessage } from "./telegram";

export type NotifyInput = {
  sub: string;
  medId: string;
  time: string;
};

export type NotifyResult =
  | { sent: true; key: string }
  | { sent: false; reason: string };

export async function notifyOneDose(input: NotifyInput): Promise<NotifyResult> {
  const { sub, medId, time } = input;
  const cfg = await getConfig(sub);
  if (!cfg.chatId) return { sent: false, reason: "no chatId" };

  const meds = await listMeds(sub);
  const med = meds.find((m) => m.id === medId);
  if (!med) return { sent: false, reason: "med deleted" };

  const { date } = nowInTz(cfg.timezone);
  const key = slotKey(medId, time);
  const log = await getLog(sub, date);
  if (log[key]?.taken) return { sent: false, reason: "already taken" };
  if (await wasNotified(sub, date, key)) return { sent: false, reason: "already notified" };

  const profiles = await listProfiles(sub);
  const showProfile = profiles.length >= 2;
  const profile = showProfile ? profiles.find((p) => p.id === med.profileId) : null;
  const heading = profile
    ? `<b>Hora do remédio · ${escapeHtml(profile.name)}</b>`
    : `<b>Hora do remédio</b>`;
  const dosage = med.dosage ? ` — ${escapeHtml(med.dosage)}` : "";

  await sendMessage({
    chatId: cfg.chatId,
    text: `${heading}\n${escapeHtml(med.name)}${dosage}\n<code>${time}</code>`,
    buttons: [
      [
        { text: "✓ Tomei", callback_data: `taken:${key}` },
        { text: "Pular", callback_data: `skip:${key}` },
      ],
    ],
  });
  await markNotified(sub, date, key);
  return { sent: true, key };
}
