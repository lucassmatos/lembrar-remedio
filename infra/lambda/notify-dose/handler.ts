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

  // If a dose failed every send, notifyOneDose released its claim. Throw so
  // EventBridge retries this invocation (2x / 300s); the released slot re-sends
  // and already-sent slots stay claimed (no double-send). Reschedule already
  // ran above, so the next dose is set regardless of the retry.
  const failed = fired.filter(
    (f) => !f.result.sent && f.result.reason === "all sends failed",
  );
  if (failed.length > 0) {
    throw new Error(
      `notify: ${failed.length} dose(s) failed all sends; released for retry`,
    );
  }
  return { ...target, fired, next };
}
