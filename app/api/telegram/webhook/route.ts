import { NextRequest, NextResponse } from "next/server";
import {
  consumePairToken,
  getChatOwner,
  getConfig,
  setChatMapping,
  setConfig,
  setLogEntry,
} from "@/lib/ddb";
import { answerCallback, editMessage, sendMessage, escapeHtml } from "@/lib/telegram";
import { nowInTz } from "@/lib/schedule";

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

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const update = (await req.json()) as Update;

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
  const text = (msg.text || "").trim();

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
          `Vou te avisar na hora de cada remédio. Toque em "✓ Tomei" pra marcar.`,
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
  const data = cq.data || "";
  const chat = cq.message?.chat;
  if (!chat) {
    await answerCallback(cq.id);
    return;
  }
  const sub = await getChatOwner(chat.id);
  if (!sub) {
    await answerCallback(cq.id, "Chat não vinculado.");
    return;
  }
  const cfg = await getConfig(sub);
  const date = nowInTz(cfg.timezone).date;

  if (data.startsWith("taken:")) {
    const slotKey = data.slice("taken:".length);
    await setLogEntry(sub, date, slotKey, true);
    await answerCallback(cq.id, "Marcado ✓");
    if (cq.message) {
      const newText = (cq.message.text || "") + "\n\n<b>✓ Tomado</b>";
      await editMessage({ chatId: chat.id, messageId: cq.message.message_id, text: newText });
    }
  } else if (data.startsWith("skip:")) {
    const slotKey = data.slice("skip:".length);
    await setLogEntry(sub, date, slotKey, false);
    await answerCallback(cq.id, "Pulado");
    if (cq.message) {
      const newText = (cq.message.text || "") + "\n\n<b>— Pulado</b>";
      await editMessage({ chatId: chat.id, messageId: cq.message.message_id, text: newText });
    }
  } else {
    await answerCallback(cq.id);
  }
}
