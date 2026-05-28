import { notifyBirthdaysForUser } from "../../../lib/notify-birthday";

type Event = { ownerSub?: string };

/**
 * Disparado todo dia às 08:00 (timezone do usuário) pelo EventBridge Scheduler.
 * Um scheduler por usuário (sem fan-out entre parceiros — cada um tem o seu
 * scheduler, no próprio tz, e o handler busca os aniversários da casa dele
 * via getPartner). Returns sem fazer nada se o digest do dia tá vazio.
 */
export async function handler(event: Event) {
  if (!event?.ownerSub) {
    console.error("invalid event, missing ownerSub", event);
    throw new Error("missing ownerSub");
  }
  const result = await notifyBirthdaysForUser(event.ownerSub);
  console.log("notify-birthdays", {
    sub: result.sub,
    shouldNotify: result.shouldNotify,
    today: result.digest.today.length,
    week: result.digest.thisWeek.length,
    month: result.digest.thisMonth.length,
    telegramSent: result.telegramSent,
    pushSent: result.pushSent,
    pushPruned: result.pushPruned,
    noChannels: result.noChannels,
  });
  return result;
}
