import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  consumePairToken,
  getChatOwner,
  getConfig,
  setChatMapping,
  setConfig,
  setLogEntryForProfile,
  setReminderStatusForProfile,
} from "@/lib/ddb";
import { answerCallback, editMessage, sendMessage, escapeHtml } from "@/lib/telegram";
import { nowInTz } from "@/lib/schedule";
import { findReminder } from "@/lib/sharing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Update = {
  message?: {
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number };
    message?: { chat: { id: number }; message_id: number; text?: string };
  };
};

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const SLOT_KEY_RE = /^[A-Za-z0-9_-]{1,32}@\d{2}:\d{2}$/;
const REMINDER_ID_RE = /^[A-Za-z0-9_-]{1,16}$/;

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error("TELEGRAM_WEBHOOK_SECRET not configured");
    return new NextResponse("misconfigured", { status: 500 });
  }
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!constantTimeEqual(got, secret)) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const text = await req.text();
  if (text.length > 64 * 1024) {
    return new NextResponse("payload too large", { status: 413 });
  }
  let update: Update;
  try {
    update = JSON.parse(text) as Update;
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  if (update.message) {
    await handleMessage(update.message);
  }

  if (update.callback_query) {
    await handleCallback(update.callback_query);
  }

  return NextResponse.json({ ok: true });
}

async function handleMessage(msg: NonNullable<Update["message"]>) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim().slice(0, 1024);

  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    const pairingToken = parts[1];
    if (pairingToken) {
      const sub = await consumePairToken(pairingToken);
      if (!sub) {
        await sendMessage({
          chatId,
          text: "Link de pareamento inválido ou expirado. Gere outro no app.",
        });
        return;
      }
      const cfg = await getConfig(sub);
      await setConfig(sub, { chatId });
      await setChatMapping(chatId, sub);
      await sendMessage({
        chatId,
        text:
          `<b>Pronto.</b>\nVinculado à conta <code>${escapeHtml(cfg.email ?? sub)}</code>. ` +
          `Vou te avisar na hora de cada medicamento. Toque em "✓ Tomei" pra marcar.`,
      });
    } else {
      const existing = await getChatOwner(chatId);
      if (existing) {
        await sendMessage({
          chatId,
          text: "Já estou vinculado a uma conta. Pra trocar, gere um novo link no app.",
        });
      } else {
        await sendMessage({
          chatId,
          text: "Pra começar, abra o app, vá em Ajustes → Conectar Telegram e use o link que aparecer.",
        });
      }
    }
    return;
  }

  if (text === "/desvincular" || text === "/unlink") {
    const sub = await getChatOwner(chatId);
    if (!sub) {
      await sendMessage({ chatId, text: "Esse chat não está vinculado a nenhuma conta." });
      return;
    }
    await setConfig(sub, { chatId: undefined });
    await sendMessage({ chatId, text: "Desvinculado. Não vou mais te avisar." });
  }
}

async function handleCallback(cq: NonNullable<Update["callback_query"]>) {
  const data = (cq.data || "").slice(0, 128);
  const chat = cq.message?.chat;
  if (!chat) {
    await answerCallback(cq.id);
    return;
  }
  // Resolve the sub that owns this chat — unchanged (chat mapping is still per-user).
  const sub = await getChatOwner(chat.id);
  if (!sub) {
    await answerCallback(cq.id, "Chat não vinculado.");
    return;
  }
  // Use the clicker's own timezone for the current date.
  // Minor caveat: if the clicker's tz differs from the profile owner's tz, the
  // date used here may differ from the date used when the notification was sent.
  // This is rare (shared profiles typically span the same tz) and acceptable.
  const cfg = await getConfig(sub);
  const date = nowInTz(cfg.timezone).date;

  if (data.startsWith("taken:") || data.startsWith("skip:")) {
    const slotKey = data.slice(data.indexOf(":") + 1);
    if (!SLOT_KEY_RE.test(slotKey)) {
      await answerCallback(cq.id, "Botão inválido.");
      return;
    }
    const taken = data.startsWith("taken:");
    // Resolve the profile that owns this reminder via the accessible-profile walker.
    const reminderId = slotKey.split("@")[0];
    const found = await findReminder(sub, reminderId);
    if (!found) {
      await answerCallback(cq.id, "Lembrete não encontrado.");
      return;
    }
    // Record takenBy=sub so we know which member marked it.
    await setLogEntryForProfile(found.profileId, date, slotKey, taken, sub, cfg.name ?? undefined);
    await answerCallback(cq.id, taken ? "Marcado ✓" : "Pulado");
    if (cq.message) {
      const newText =
        (cq.message.text || "") + (taken ? "\n\n<b>✓ Tomado</b>" : "\n\n<b>— Pulado</b>");
      await editMessage({ chatId: chat.id, messageId: cq.message.message_id, text: newText });
    }
    if (taken) {
      const { notifyOtherMembersOfTaken } = await import("@/lib/notify-one");
      notifyOtherMembersOfTaken({
        profileId: found.profileId,
        date,
        slotKey,
        takenBySub: sub,
        takenByName: cfg.name ?? null,
      }).catch((e: unknown) => console.warn("[webhook] notifyOtherMembersOfTaken failed:", e));
    }
    return;
  }

  if (data.startsWith("agendei:") || data.startsWith("fiz:")) {
    const reminderId = data.slice(data.indexOf(":") + 1);
    if (!REMINDER_ID_RE.test(reminderId)) {
      await answerCallback(cq.id, "Botão inválido.");
      return;
    }
    // Resolve profile for this reminder.
    const found = await findReminder(sub, reminderId);
    if (!found) {
      await answerCallback(cq.id, "Lembrete não encontrado.");
      return;
    }
    const nextStatus = data.startsWith("agendei:") ? "scheduled" : "done";
    const updated = await setReminderStatusForProfile(found.profileId, reminderId, nextStatus);
    if (!updated) {
      await answerCallback(cq.id, "Lembrete não encontrado.");
      return;
    }
    await answerCallback(cq.id, nextStatus === "scheduled" ? "Agendado ✓" : "Feito ✓");
    if (cq.message) {
      const newText =
        (cq.message.text || "") +
        (nextStatus === "scheduled" ? "\n\n<b>✓ Agendado</b>" : "\n\n<b>✓ Feito</b>");
      await editMessage({ chatId: chat.id, messageId: cq.message.message_id, text: newText });
    }
    return;
  }

  await answerCallback(cq.id);
}
