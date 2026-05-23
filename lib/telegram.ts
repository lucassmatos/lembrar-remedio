const API = "https://api.telegram.org";

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN não configurado");
  return t;
}

export function botUsername(): string {
  const u = process.env.TELEGRAM_BOT_USERNAME;
  if (!u) throw new Error("TELEGRAM_BOT_USERNAME não configurado");
  return u.replace(/^@/, "");
}

type Button = { text: string; callback_data: string };

export async function sendMessage(args: {
  chatId: number;
  text: string;
  buttons?: Button[][];
}): Promise<{ message_id?: number }> {
  const body: Record<string, unknown> = {
    chat_id: args.chatId,
    text: args.text,
    parse_mode: "HTML",
  };
  if (args.buttons) body.reply_markup = { inline_keyboard: args.buttons };
  const res = await fetch(`${API}/bot${token()}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
    description?: string;
  };
  if (!json.ok) throw new Error(`Telegram sendMessage falhou: ${json.description}`);
  return { message_id: json.result?.message_id };
}

export async function editMessage(args: {
  chatId: number;
  messageId: number;
  text: string;
  buttons?: Button[][];
}): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: args.chatId,
    message_id: args.messageId,
    text: args.text,
    parse_mode: "HTML",
  };
  if (args.buttons) body.reply_markup = { inline_keyboard: args.buttons };
  await fetch(`${API}/bot${token()}/editMessageText`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await fetch(`${API}/bot${token()}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  });
}

export async function setWebhook(url: string, secretToken: string): Promise<unknown> {
  const res = await fetch(`${API}/bot${token()}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"],
    }),
  });
  return res.json();
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
