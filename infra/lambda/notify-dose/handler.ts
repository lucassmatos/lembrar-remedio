import { notifyOneDose } from "../../../lib/notify-one";
import { computeNextDose, defaultDeps } from "../../../lib/next-dose";
import { updateProfileSchedule } from "../schedule-sync/profile-schedule";

type Event = { profileId?: string; ownerSub?: string };

export async function handler(event: Event) {
  if (!event?.profileId || !event?.ownerSub) {
    console.error("invalid event, missing profileId/ownerSub", event);
    throw new Error("missing profileId/ownerSub");
  }
  const target = { profileId: event.profileId, ownerSub: event.ownerSub };
  const { due } = await computeNextDose(target, defaultDeps);
  const fired = [];
  for (const input of due) {
    const result = await notifyOneDose(input);
    fired.push({ input, result });
    console.log("notify", { input, result });
  }
  const next = await updateProfileSchedule(target);
  console.log("rescheduled", { ...target, next });
  return { ...target, fired, next };
}
