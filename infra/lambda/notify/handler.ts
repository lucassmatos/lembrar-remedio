import { notifyOneDose, type NotifyInput } from "../../../lib/notify-one";

export async function handler(event: NotifyInput): Promise<unknown> {
  if (!event?.sub || !event?.medId || !event?.time) {
    console.error("invalid event", event);
    return { sent: false, reason: "invalid event" };
  }
  const result = await notifyOneDose(event);
  console.log("notify result", { ...event, ...result });
  return result;
}
