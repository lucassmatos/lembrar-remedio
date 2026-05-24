import { notifyOneDose, type NotifyInput, type NotifyResult } from "../../../lib/notify-one";
import { computeNextDose, defaultDeps } from "../../../lib/next-dose";
import { updateUserSchedule } from "../schedule-sync/user-schedule";

type Event = { sub?: string };

export async function handler(event: Event): Promise<{
  sub: string;
  fired: Array<{ input: NotifyInput; result: NotifyResult }>;
  next: Awaited<ReturnType<typeof updateUserSchedule>>;
}> {
  if (!event?.sub) {
    console.error("invalid event, missing sub", event);
    throw new Error("missing sub");
  }
  const { sub } = event;

  const { due } = await computeNextDose(sub, defaultDeps);

  const fired: Array<{ input: NotifyInput; result: NotifyResult }> = [];
  for (const input of due) {
    const result = await notifyOneDose(input);
    fired.push({ input, result });
    console.log("notify", { input, result });
  }

  // Re-compute and update the schedule based on the new state (markNotified writes
  // during the loop above shift what counts as the "next" occurrence).
  const next = await updateUserSchedule(sub);
  console.log("rescheduled", { sub, next });

  return { sub, fired, next };
}
