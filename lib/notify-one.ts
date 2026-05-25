import {
  getConfig,
  getLogForProfile,
  getReminderForProfile,
  markNotifiedForProfile,
  unmarkNotifiedForProfile,
  listPushSubs,
  deletePushSub,
  _internal,
} from "./ddb";
import { sendWebPush } from "./push";
import {
  formatBrDate,
  nowInTz,
  occurrenceKey,
  slotKey,
} from "./schedule";
import { editMessage, escapeHtml, sendMessage } from "./telegram";
import { parseMessageKey, sanitizeMessageKey } from "./profile-keys";
import type { Reminder } from "./types";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

export type NotifyInput =
  | { profileId: string; ownerSub: string; reminderId: string; time: string }
  | { profileId: string; ownerSub: string; reminderId: string; targetDate: string; lead: number };

export type NotifyResult =
  | { sent: true; key: string }
  | { sent: false; reason: string };

function isOneShotInput(
  input: NotifyInput,
): input is { profileId: string; ownerSub: string; reminderId: string; targetDate: string; lead: number } {
  return "targetDate" in input;
}

const KIND_LABEL = {
  medication: { icon: "💊", noun: "Medicamento" },
  vaccine: { icon: "💉", noun: "Vacina" },
  appointment: { icon: "📅", noun: "Consulta" },
} as const;

function leadCopy(lead: number): string {
  if (lead === 0) return "hoje";
  if (lead === 1) return "amanhã";
  return `daqui ${lead} dias`;
}

type ProfileMeta = {
  ownerSub: string;
  profileId: string;
  name?: string;
  sharedWith?: Array<{ sub: string; role: string }>;
};

/**
 * Load profile metadata from the owner's item (user#<ownerSub>/profile#<profileId>).
 * This is the canonical record that holds name + sharedWith.
 */
async function loadProfileMeta(ownerSub: string, profileId: string): Promise<ProfileMeta | null> {
  const { PK, SK, doc, TABLE } = _internal;
  const res = await doc.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: PK.user(ownerSub), sk: SK.profile(profileId) },
    }),
  );
  if (!res.Item) return null;
  const item = res.Item as Record<string, unknown>;
  return {
    ownerSub: (item.ownerSub as string) ?? ownerSub,
    profileId: (item.id as string) ?? profileId,
    name: item.name as string | undefined,
    sharedWith: (item.sharedWith as Array<{ sub: string; role: string }>) ?? [],
  };
}

/**
 * Persist message refs into the notified record so Phase F can edit them on "taken".
 * Stored at profile#<profileId>/notified#<date> under a `messages` map.
 * Key = sanitizeMessageKey(slotKey, sub); value = { chatId, messageId }.
 *
 * Uses Get-then-Put to avoid needing nested map path support in dev-store.
 * Wrapped in try/catch — failure here must NOT fail the whole notify.
 */
async function persistMessageRefs(
  profileId: string,
  date: string,
  notifiedKey: string,
  refs: Array<{ sub: string; chatId: number; messageId: number }>,
): Promise<void> {
  const { PK, SK, doc, TABLE } = _internal;
  const pk = PK.profile(profileId);
  const sk = SK.notified(date);
  try {
    const existing = await doc.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }));
    const item = (existing.Item ?? { pk, sk }) as Record<string, unknown>;
    const messages = (item.messages ?? {}) as Record<string, unknown>;
    for (const ref of refs) {
      messages[sanitizeMessageKey(notifiedKey, ref.sub)] = {
        chatId: ref.chatId,
        messageId: ref.messageId,
      };
    }
    // Always set a TTL — the Get-then-Put would otherwise drop it when the
    // item is missing, leaving the notified record alive forever. This map is
    // best-effort (used for cross-member Telegram edits) and may drop refs
    // under concurrent partial-send retries.
    const ttl = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
    await doc.send(
      new PutCommand({
        TableName: TABLE,
        Item: { ...item, pk, sk, messages, ttl },
      }),
    );
  } catch (e) {
    console.warn("[notify-one] failed to persist message refs:", e);
  }
}

/**
 * Sends the notification to every paired member, persists message refs, and
 * decides the claim's fate. The slot is claimed BEFORE this runs (atomic dedup
 * against concurrent fires). If every send to a reachable member fails, the
 * claim is released and a failure is returned so the handler can throw and let
 * EventBridge retry (2x/300s, within the 60min catch-up) — otherwise a transient
 * Telegram blip would silently lose the dose.
 */
type TelegramMsg = { text: string; buttons: { text: string; callback_data: string }[][] };
type PushMsg = { title: string; body: string; url: string };

async function fanOutAndClaim(
  profileId: string,
  date: string,
  key: string,
  memberSubs: string[],
  telegram: TelegramMsg,
  push: PushMsg,
): Promise<NotifyResult> {
  const refs: Array<{ sub: string; chatId: number; messageId: number }> = [];
  let attempted = 0; // members with at least one channel to try
  let reached = 0; // members reached on at least one channel

  for (const memberSub of memberSubs) {
    const cfg = await getConfig(memberSub);
    const subs = await listPushSubs(memberSub);
    const hasTelegram = !!cfg.chatId;
    if (!hasTelegram && subs.length === 0) continue;
    attempted++;
    let ok = false;

    if (hasTelegram) {
      try {
        const { message_id } = await sendMessage({
          chatId: cfg.chatId as number,
          text: telegram.text,
          buttons: telegram.buttons,
        });
        ok = true;
        if (message_id !== undefined) {
          refs.push({ sub: memberSub, chatId: cfg.chatId as number, messageId: message_id });
        }
      } catch (e) {
        console.warn(`[notify-one] sendMessage failed for member ${memberSub}:`, e);
      }
    }

    for (const s of subs) {
      const res = await sendWebPush(
        { endpoint: s.endpoint, keys: s.keys },
        { title: push.title, body: push.body, url: push.url, tag: key },
      );
      if (res.ok) ok = true;
      else if (res.gone) await deletePushSub(memberSub, s.id);
    }

    if (ok) reached++;
  }

  if (refs.length > 0) {
    await persistMessageRefs(profileId, date, key, refs);
  }

  // Every channel to every reachable member failed: release the claim so
  // EventBridge retries. Partial success (any channel, any member) keeps it.
  if (attempted > 0 && reached === 0) {
    await unmarkNotifiedForProfile(profileId, date, key);
    return { sent: false, reason: "all sends failed" };
  }

  // sent:true when the claim was won — including the no-channel case (nothing to
  // send, but the dose was meaningfully handled).
  return { sent: true, key };
}

export async function notifyOneDose(input: NotifyInput): Promise<NotifyResult> {
  const { profileId, ownerSub, reminderId } = input;

  // 1. Load reminder.
  const reminder = await getReminderForProfile(profileId, reminderId);
  if (!reminder) return { sent: false, reason: "reminder deleted" };

  // 2. Load profile metadata to get name (for profileTag) and member list.
  const meta = await loadProfileMeta(ownerSub, profileId);
  const profileName = meta?.name ?? "";
  const sharedWith = meta?.sharedWith ?? [];
  const memberSubs: string[] = [ownerSub, ...sharedWith.map((e) => e.sub)];

  // 3. Owner timezone for date computation.
  const ownerCfg = await getConfig(ownerSub);
  const { date } = nowInTz(ownerCfg.timezone);

  if (isOneShotInput(input)) {
    return sendOneShot(reminder, input, profileName, memberSubs, date);
  }
  return sendMedSlot(reminder, input, profileName, memberSubs, date);
}

async function sendMedSlot(
  reminder: Reminder,
  input: { profileId: string; ownerSub: string; reminderId: string; time: string },
  profileName: string,
  memberSubs: string[],
  date: string,
): Promise<NotifyResult> {
  if (reminder.kind !== "medication") {
    return { sent: false, reason: "kind mismatch" };
  }
  const { profileId, time } = input;
  const key = slotKey(reminder.id, time);

  // Check if already taken.
  const log = await getLogForProfile(profileId, date);
  if (log[key]?.taken) return { sent: false, reason: "already taken" };

  // Atomic claim — if someone else already marked, skip the send.
  const won = await markNotifiedForProfile(profileId, date, key);
  if (!won) return { sent: false, reason: "already notified" };

  const label = KIND_LABEL.medication;
  // Always show profile name tag — a notification is about one specific profile.
  const tag = profileName ? ` · ${escapeHtml(profileName)}` : "";
  const heading = `<b>${label.icon} ${label.noun}${tag}</b>`;
  const sub2 = reminder.subtitle ? ` — ${escapeHtml(reminder.subtitle)}` : "";
  const text = `${heading}\n${escapeHtml(reminder.title)}${sub2}\n<code>${time}</code>`;
  const buttons = [
    [
      { text: "✓ Tomei", callback_data: `taken:${key}` },
      { text: "Pular", callback_data: `skip:${key}` },
    ],
  ];

  return fanOutAndClaim(
    profileId,
    date,
    key,
    memberSubs,
    { text, buttons },
    {
      title: `💊 ${reminder.title}${profileName ? ` · ${profileName}` : ""}`,
      body: `${reminder.subtitle ? `${reminder.subtitle} · ` : ""}${time}`,
      url: "/",
    },
  );
}

async function sendOneShot(
  reminder: Reminder,
  input: { profileId: string; ownerSub: string; reminderId: string; targetDate: string; lead: number },
  profileName: string,
  memberSubs: string[],
  date: string,
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

  const { profileId } = input;
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
  const won = await markNotifiedForProfile(profileId, date, key);
  if (!won) return { sent: false, reason: "already notified" };

  const label = KIND_LABEL[reminder.kind];
  const lc = leadCopy(input.lead);
  const tag = profileName ? ` · ${escapeHtml(profileName)}` : "";
  const heading = `<b>${label.icon} ${label.noun}${tag} · ${lc}</b>`;
  const lines: string[] = [heading, escapeHtml(reminder.title)];
  if (reminder.subtitle) lines.push(escapeHtml(reminder.subtitle));
  lines.push(
    `<i>${input.lead === 0 ? "É hoje" : `em ${escapeHtml(formatBrDate(input.targetDate))}`}</i>`,
  );
  const text = lines.join("\n");

  const buttons =
    status === "unscheduled"
      ? [[{ text: "✓ Já agendei", callback_data: `agendei:${reminder.id}` }]]
      : [[{ text: "✓ Já fiz", callback_data: `fiz:${reminder.id}` }]];

  return fanOutAndClaim(
    profileId,
    date,
    key,
    memberSubs,
    { text, buttons },
    {
      title: `${label.icon} ${reminder.title}${profileName ? ` · ${profileName}` : ""}`,
      body: `${label.noun} · ${lc}${reminder.subtitle ? ` · ${reminder.subtitle}` : ""}`,
      url: "/lembretes",
    },
  );
}

/**
 * After a member marks a slot as taken, edit the Telegram notification messages
 * of all OTHER members so they stop worrying.
 *
 * Reads the `messages` map stored at profile#<profileId>/notified#<date>,
 * skips the entry for the member who marked it, and calls editMessage for each
 * remaining member. Failures are swallowed per-entry — a stale or blocked
 * message must never break the mark flow.
 */
export async function notifyOtherMembersOfTaken(args: {
  profileId: string;
  date: string;
  slotKey: string;
  takenBySub: string;
  takenByName?: string | null;
}): Promise<void> {
  const { PK, SK, doc, TABLE } = _internal;
  const { profileId, date, slotKey: sk, takenBySub, takenByName } = args;

  let messages: Record<string, unknown>;
  try {
    const res = await doc.send(
      new GetCommand({
        TableName: TABLE,
        Key: { pk: PK.profile(profileId), sk: SK.notified(date) },
      }),
    );
    messages = ((res.Item?.messages ?? {}) as Record<string, unknown>);
  } catch (e) {
    console.warn("[notify-one] notifyOtherMembersOfTaken: failed to read notified record:", e);
    return;
  }

  const displayName = takenByName ?? "Alguém";
  const editText = `✅ ${escapeHtml(displayName)} marcou.`;

  for (const [key, val] of Object.entries(messages)) {
    // Decode the key to extract slotKey + sub.
    let parsed: { slotKey: string; sub: string };
    try {
      parsed = parseMessageKey(key);
    } catch {
      // Malformed key — skip silently.
      continue;
    }

    // Only edit messages for this slotKey and skip the taker's own message.
    if (parsed.slotKey !== sk) continue;
    if (parsed.sub === takenBySub) continue;

    const ref = val as { chatId?: number; messageId?: number };
    if (!ref.chatId || !ref.messageId) continue;

    try {
      await editMessage({ chatId: ref.chatId, messageId: ref.messageId, text: editText });
    } catch (e) {
      // Telegram errors (message too old, bot blocked, stale id) must be swallowed.
      console.warn(
        `[notify-one] notifyOtherMembersOfTaken: editMessage failed for sub=${parsed.sub}:`,
        e,
      );
    }
  }
}
