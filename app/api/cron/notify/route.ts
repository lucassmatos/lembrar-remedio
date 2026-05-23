import { NextRequest, NextResponse } from "next/server";
import {
  getConfig,
  getLog,
  listAllUsers,
  listMeds,
  markNotified,
  wasNotified,
} from "@/lib/ddb";
import { nowInTz, slotKey, todaySlots } from "@/lib/schedule";
import { escapeHtml, sendMessage } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const WINDOW_BEFORE = 0;
const WINDOW_AFTER = Number(process.env.CRON_WINDOW_MIN ?? 5);

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const secret = process.env.APP_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const users = await listAllUsers();
  const eligible = users.filter((u) => u.hasChat);

  const sentByUser: Record<string, string[]> = {};
  let totalSent = 0;

  for (const u of eligible) {
    try {
      const sent = await notifyUser(u.sub);
      if (sent.length > 0) {
        sentByUser[u.sub] = sent;
        totalSent += sent.length;
      }
    } catch (e) {
      console.error(`notifyUser ${u.sub} failed`, e);
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    users: eligible.length,
    totalSent,
    sentByUser,
  });
}

async function notifyUser(sub: string): Promise<string[]> {
  const cfg = await getConfig(sub);
  if (!cfg.chatId) return [];
  const { date, minutes } = nowInTz(cfg.timezone);
  const meds = await listMeds(sub);
  if (meds.length === 0) return [];
  const log = await getLog(sub, date);
  const slots = todaySlots(meds, log, { date, tz: cfg.timezone });

  const sent: string[] = [];
  for (const s of slots) {
    if (s.taken) continue;
    if (s.minutes < minutes - WINDOW_AFTER) continue;
    if (s.minutes > minutes + WINDOW_BEFORE) continue;
    const key = slotKey(s.medId, s.time);
    if (await wasNotified(sub, date, key)) continue;

    const dosage = s.med.dosage ? ` — ${escapeHtml(s.med.dosage)}` : "";
    await sendMessage({
      chatId: cfg.chatId,
      text:
        `<b>Hora do remédio</b>\n` +
        `${escapeHtml(s.med.name)}${dosage}\n` +
        `<code>${s.time}</code>`,
      buttons: [
        [
          { text: "✓ Tomei", callback_data: `taken:${key}` },
          { text: "Pular", callback_data: `skip:${key}` },
        ],
      ],
    });
    await markNotified(sub, date, key);
    sent.push(key);
  }
  return sent;
}
