import {
  getConfig,
  getLog,
  getReminder,
  listProfiles,
  markNotified,
} from "./ddb";
import {
  formatBrDate,
  nowInTz,
  occurrenceKey,
  slotKey,
} from "./schedule";
import { escapeHtml, sendMessage } from "./telegram";
import type { Profile, Reminder } from "./types";

export type NotifyInput =
  | { sub: string; reminderId: string; time: string }
  | { sub: string; reminderId: string; targetDate: string; lead: number };

export type NotifyResult =
  | { sent: true; key: string }
  | { sent: false; reason: string };

function isOneShotInput(
  input: NotifyInput,
): input is { sub: string; reminderId: string; targetDate: string; lead: number } {
  return "targetDate" in input;
}

const KIND_LABEL = {
  medication: { icon: "💊", noun: "Medicamento" },
  vaccine: { icon: "💉", noun: "Vacina" },
  appointment: { icon: "📅", noun: "Consulta" },
} as const;

function profileTag(profiles: Profile[], reminder: Reminder): string {
  if (profiles.length < 2) return "";
  const p = profiles.find((x) => x.id === reminder.profileId);
  return p ? ` · ${escapeHtml(p.name)}` : "";
}

function leadCopy(lead: number): string {
  if (lead === 0) return "hoje";
  if (lead === 1) return "amanhã";
  return `daqui ${lead} dias`;
}

export async function notifyOneDose(input: NotifyInput): Promise<NotifyResult> {
  const { sub, reminderId } = input;
  const cfg = await getConfig(sub);
  if (!cfg.chatId) return { sent: false, reason: "no chatId" };

  const reminder = await getReminder(sub, reminderId);
  if (!reminder) return { sent: false, reason: "reminder deleted" };

  const profiles = await listProfiles(sub);
  const { date } = nowInTz(cfg.timezone);

  if (isOneShotInput(input)) {
    return sendOneShot(reminder, input, profiles, cfg.chatId, date, sub);
  }
  return sendMedSlot(reminder, input, profiles, cfg.chatId, date, sub);
}

async function sendMedSlot(
  reminder: Reminder,
  input: { sub: string; reminderId: string; time: string },
  profiles: Profile[],
  chatId: number,
  date: string,
  sub: string,
): Promise<NotifyResult> {
  if (reminder.kind !== "medication") {
    return { sent: false, reason: "kind mismatch" };
  }
  const { time } = input;
  const key = slotKey(reminder.id, time);
  const log = await getLog(sub, date);
  if (log[key]?.taken) return { sent: false, reason: "already taken" };

  // Atomic claim — if someone else already marked, skip the send.
  const won = await markNotified(sub, date, key);
  if (!won) return { sent: false, reason: "already notified" };

  const label = KIND_LABEL.medication;
  const heading = `<b>${label.icon} ${label.noun}${profileTag(profiles, reminder)}</b>`;
  const sub2 = reminder.subtitle ? ` — ${escapeHtml(reminder.subtitle)}` : "";

  await sendMessage({
    chatId,
    text: `${heading}\n${escapeHtml(reminder.title)}${sub2}\n<code>${time}</code>`,
    buttons: [
      [
        { text: "✓ Tomei", callback_data: `taken:${key}` },
        { text: "Pular", callback_data: `skip:${key}` },
      ],
    ],
  });
  return { sent: true, key };
}

async function sendOneShot(
  reminder: Reminder,
  input: { sub: string; reminderId: string; targetDate: string; lead: number },
  profiles: Profile[],
  chatId: number,
  date: string,
  sub: string,
): Promise<NotifyResult> {
  if (reminder.kind === "medication") {
    return { sent: false, reason: "kind mismatch" };
  }
  if (reminder.status === "done") return { sent: false, reason: "already done" };
  if (reminder.schedule.type !== "one-shot") {
    return { sent: false, reason: "schedule mismatch" };
  }
  if (reminder.schedule.date !== input.targetDate) {
    return { sent: false, reason: "stale schedule (date changed)" };
  }

  const status = reminder.status ?? "unscheduled";
  // Don't fire post-lead while still unscheduled, or pre-lead while scheduled.
  const isPreLead = (reminder.preLeadDays ?? []).includes(input.lead);
  const isPostLead = (reminder.postLeadDays ?? []).includes(input.lead);
  if (status === "unscheduled" && !isPreLead) {
    return { sent: false, reason: "not a pre-lead in current status" };
  }
  if (status === "scheduled" && !isPostLead) {
    return { sent: false, reason: "not a post-lead in current status" };
  }

  const key = occurrenceKey(reminder.id, input.targetDate, input.lead);
  const won = await markNotified(sub, date, key);
  if (!won) return { sent: false, reason: "already notified" };

  const label = KIND_LABEL[reminder.kind];
  const lc = leadCopy(input.lead);
  const heading =
    `<b>${label.icon} ${label.noun}${profileTag(profiles, reminder)} · ${lc}</b>`;
  const lines: string[] = [heading, escapeHtml(reminder.title)];
  if (reminder.subtitle) lines.push(escapeHtml(reminder.subtitle));
  lines.push(
    `<i>${input.lead === 0 ? "É hoje" : `em ${escapeHtml(formatBrDate(input.targetDate))}`}</i>`,
  );

  const buttons =
    status === "unscheduled"
      ? [[{ text: "✓ Já agendei", callback_data: `agendei:${reminder.id}` }]]
      : [[{ text: "✓ Já fiz", callback_data: `fiz:${reminder.id}` }]];

  await sendMessage({
    chatId,
    text: lines.join("\n"),
    buttons,
  });
  return { sent: true, key };
}
