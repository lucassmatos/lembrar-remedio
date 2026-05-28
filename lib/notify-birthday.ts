import {
  birthdaysForHousehold,
  deletePushSub,
  getConfig,
  listPushSubs,
} from "./ddb";
import { sendMessage } from "./telegram";
import { sendWebPush } from "./push";
import { dateInTz } from "./schedule";
import { daysUntilBirthday, isBirthdayToday } from "./birthdays";
import type { Birthday } from "./types";

export type BirthdayDigest = {
  today: Birthday[];
  /** Aniversários do mês corrente — só preenchido no dia 01. */
  thisMonth: Birthday[];
  /** Próximos 7 dias (incluindo hoje) — só preenchido na segunda. */
  thisWeek: Birthday[];
  /** Quando a notificação deve ser enviada (alguma lista não vazia). */
  shouldNotify: boolean;
};

/** Calcula o digest pra uma data específica (testável sem mexer no DDB). */
export function computeDigest(
  birthdays: Birthday[],
  atMs: number,
  tz: string,
): BirthdayDigest {
  const { date: today } = dateInTz(atMs, tz);
  const [, m, d] = today.split("-").map(Number);
  const dow = new Date(today + "T00:00:00Z").getUTCDay(); // 0=dom, 1=seg

  const todayList = birthdays.filter((b) => isBirthdayToday(b, atMs, tz));

  const thisMonth =
    d === 1
      ? [...birthdays.filter((b) => b.month === m)].sort((a, b) => a.day - b.day)
      : [];

  const thisWeek =
    dow === 1
      ? [...birthdays]
          .filter((b) => {
            const days = daysUntilBirthday(b, atMs, tz);
            return days >= 0 && days < 7;
          })
          .sort((a, b) => daysUntilBirthday(a, atMs, tz) - daysUntilBirthday(b, atMs, tz))
      : [];

  return {
    today: todayList,
    thisMonth,
    thisWeek,
    shouldNotify: todayList.length > 0 || thisMonth.length > 0 || thisWeek.length > 0,
  };
}

/** Monta o texto Telegram (HTML). Inclui só as seções não vazias. */
export function formatTelegram(digest: BirthdayDigest): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const sections: string[] = [];
  if (digest.today.length > 0) {
    const lines = digest.today.map((b) => `• ${escapeHtml(b.name)}`).join("\n");
    sections.push(`<b>🎂 Hoje</b>\n${lines}`);
  }
  if (digest.thisWeek.length > 0) {
    const lines = digest.thisWeek
      .map((b) => `• ${escapeHtml(b.name)} — ${pad(b.day)}/${pad(b.month)}`)
      .join("\n");
    sections.push(`<b>Esta semana</b>\n${lines}`);
  }
  if (digest.thisMonth.length > 0) {
    const lines = digest.thisMonth
      .map((b) => `• ${escapeHtml(b.name)} — dia ${pad(b.day)}`)
      .join("\n");
    sections.push(`<b>Este mês</b>\n${lines}`);
  }
  return sections.join("\n\n");
}

/** Título + corpo curto pro Web Push. */
export function formatPush(digest: BirthdayDigest): { title: string; body: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (digest.today.length > 0) {
    return {
      title: digest.today.length === 1 ? "Aniversário hoje" : "Aniversários hoje",
      body: digest.today.map((b) => b.name).join(", "),
    };
  }
  if (digest.thisWeek.length > 0) {
    return {
      title: "Aniversários da semana",
      body: digest.thisWeek
        .map((b) => `${b.name} (${pad(b.day)}/${pad(b.month)})`)
        .join(", "),
    };
  }
  if (digest.thisMonth.length > 0) {
    return {
      title: "Aniversários do mês",
      body: digest.thisMonth.map((b) => `${b.name} dia ${b.day}`).join(", "),
    };
  }
  return { title: "Aniversários", body: "" };
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
}

export type NotifyResult = {
  sub: string;
  shouldNotify: boolean;
  digest: BirthdayDigest;
  telegramSent: boolean;
  pushSent: number;
  pushPruned: number;
  noChannels: boolean;
};

/**
 * Notifica UM usuário sobre os aniversários da casa dele (próprios + parceiro).
 * Cada usuário tem seu próprio scheduler, no próprio tz, dispara pra si mesmo
 * — sem fan-out entre parceiros (cada um recebe pelo seu próprio scheduler).
 */
export async function notifyBirthdaysForUser(sub: string): Promise<NotifyResult> {
  const cfg = await getConfig(sub);
  const tz = cfg.timezone || "America/Sao_Paulo";
  const list = await birthdaysForHousehold(sub);
  const digest = computeDigest(list, Date.now(), tz);

  const result: NotifyResult = {
    sub,
    shouldNotify: digest.shouldNotify,
    digest,
    telegramSent: false,
    pushSent: 0,
    pushPruned: 0,
    noChannels: false,
  };

  if (!digest.shouldNotify) return result;

  const text = formatTelegram(digest);
  const push = formatPush(digest);

  const hasTelegram = !!cfg.chatId;
  const pushSubs = await listPushSubs(sub);
  if (!hasTelegram && pushSubs.length === 0) {
    result.noChannels = true;
    return result;
  }

  if (hasTelegram) {
    try {
      await sendMessage({ chatId: cfg.chatId as number, text });
      result.telegramSent = true;
    } catch (e) {
      console.warn(`[notify-birthday] sendMessage failed for ${sub}:`, e);
    }
  }

  for (const s of pushSubs) {
    const res = await sendWebPush(
      { endpoint: s.endpoint, keys: s.keys },
      { title: push.title, body: push.body, url: "/casa", tag: `birthday-${sub}` },
    );
    if (res.ok) result.pushSent++;
    else if (res.gone) {
      await deletePushSub(sub, s.id);
      result.pushPruned++;
    }
  }

  return result;
}
