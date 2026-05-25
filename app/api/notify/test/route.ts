import { NextRequest, NextResponse } from "next/server";
import { getConfig, listPushSubs, deletePushSub } from "@/lib/ddb";
import { requireSession } from "@/lib/session";
import { sendMessage } from "@/lib/telegram";
import { sendWebPush } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fires a test notification to the caller, on the requested channel(s), right
// now. Lock the phone right after clicking to confirm background delivery.
export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;

  let channel: "push" | "telegram" | "both" = "both";
  try {
    const body = (await req.json()) as { channel?: string };
    if (body?.channel === "push" || body?.channel === "telegram") channel = body.channel;
  } catch {
    // default: both
  }

  const result: { telegram?: string; push?: string } = {};

  if (channel === "telegram" || channel === "both") {
    const cfg = await getConfig(s.sub);
    if (!cfg.chatId) {
      result.telegram = "no-chat";
    } else {
      try {
        await sendMessage({
          chatId: cfg.chatId,
          text: "🔔 <b>Teste</b>\nNotificação do Telegram funcionando.",
        });
        result.telegram = "sent";
      } catch {
        result.telegram = "error";
      }
    }
  }

  if (channel === "push" || channel === "both") {
    const subs = await listPushSubs(s.sub);
    if (subs.length === 0) {
      result.push = "no-device";
    } else {
      let sent = 0;
      for (const sub of subs) {
        const r = await sendWebPush(
          { endpoint: sub.endpoint, keys: sub.keys },
          { title: "🔔 Teste", body: "Notificação no app funcionando.", url: "/" },
        );
        if (r.ok) sent++;
        else if (r.gone) await deletePushSub(s.sub, sub.id);
      }
      result.push = sent > 0 ? "sent" : "failed";
    }
  }

  return NextResponse.json({ ok: true, result });
}
