import {
  SchedulerClient,
  CreateScheduleCommand,
  UpdateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  FlexibleTimeWindowMode,
  ScheduleState,
  ActionAfterCompletion,
} from "@aws-sdk/client-scheduler";
import { computeNextDose, defaultDeps, type NextDoseDeps } from "../../../lib/next-dose";

const PREFIX = "lr-user-";
const REGION = process.env.AWS_REGION || "us-east-1";
const NOTIFY_LAMBDA_ARN = process.env.NOTIFY_USER_LAMBDA_ARN || "";
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN || "";

const client = new SchedulerClient({ region: REGION });

export function userScheduleName(sub: string): string {
  const clean = sub.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
  return `${PREFIX}${clean}`;
}

// EventBridge Scheduler accepts at(YYYY-MM-DDTHH:MM:SS) interpreted as UTC by default.
function atExpression(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `at(${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())})`;
}

export type UpdateUserScheduleResult =
  | { action: "created"; nextAt: number }
  | { action: "updated"; nextAt: number }
  | { action: "deleted" }
  | { action: "noop" };

export async function updateUserSchedule(
  sub: string,
  deps: NextDoseDeps = defaultDeps,
): Promise<UpdateUserScheduleResult> {
  if (!NOTIFY_LAMBDA_ARN || !SCHEDULER_ROLE_ARN) {
    throw new Error("NOTIFY_USER_LAMBDA_ARN ou SCHEDULER_ROLE_ARN não configurados");
  }
  const { nextAt } = await computeNextDose(sub, deps);
  const name = userScheduleName(sub);
  const exists = await scheduleExists(name);

  if (nextAt === null) {
    if (!exists) return { action: "noop" };
    await deleteSchedule(name);
    return { action: "deleted" };
  }

  // EventBridge Scheduler can't be scheduled in the past — pad by a second if needed.
  const fireAt = Math.max(nextAt, Date.now() + 1000);
  const expr = atExpression(fireAt);

  if (!exists) {
    await client.send(
      new CreateScheduleCommand({
        Name: name,
        ScheduleExpression: expr,
        FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
        State: ScheduleState.ENABLED,
        ActionAfterCompletion: ActionAfterCompletion.NONE,
        Target: {
          Arn: NOTIFY_LAMBDA_ARN,
          RoleArn: SCHEDULER_ROLE_ARN,
          Input: JSON.stringify({ sub }),
          RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 300 },
        },
      }),
    );
    return { action: "created", nextAt: fireAt };
  }

  await client.send(
    new UpdateScheduleCommand({
      Name: name,
      ScheduleExpression: expr,
      FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
      State: ScheduleState.ENABLED,
      ActionAfterCompletion: ActionAfterCompletion.NONE,
      Target: {
        Arn: NOTIFY_LAMBDA_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({ sub }),
        RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 300 },
      },
    }),
  );
  return { action: "updated", nextAt: fireAt };
}

export async function deleteUserSchedule(sub: string): Promise<boolean> {
  const name = userScheduleName(sub);
  return deleteSchedule(name);
}

async function scheduleExists(name: string): Promise<boolean> {
  try {
    await client.send(new GetScheduleCommand({ Name: name }));
    return true;
  } catch (e) {
    const err = e as { name?: string };
    if (err.name === "ResourceNotFoundException") return false;
    throw e;
  }
}

async function deleteSchedule(name: string): Promise<boolean> {
  try {
    await client.send(new DeleteScheduleCommand({ Name: name }));
    return true;
  } catch (e) {
    const err = e as { name?: string };
    if (err.name === "ResourceNotFoundException") return false;
    throw e;
  }
}
