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

const PREFIX = "lr-birthdays-";
const REGION = process.env.AWS_REGION || "us-east-1";
const NOTIFY_LAMBDA_ARN = process.env.NOTIFY_BIRTHDAYS_LAMBDA_ARN || "";
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN || "";
// Cron: 08:00 todo dia, todo dia da semana, todo mês. Day-of-month e
// day-of-week são mutuamente exclusivos no EventBridge — um deve ser "?".
const CRON_8AM_DAILY = "cron(0 8 * * ? *)";

const client = new SchedulerClient({ region: REGION });

export function birthdayScheduleName(sub: string): string {
  const clean = sub.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
  return `${PREFIX}${clean}`;
}

/**
 * Cria (ou atualiza) o schedule diário de aniversários pro usuário. Idempotente:
 * cria se não existe, atualiza o tz se já existe. Sem-op se já está em sync.
 */
export async function upsertBirthdaySchedule(
  sub: string,
  tz: string,
): Promise<"created" | "updated" | "noop"> {
  if (!NOTIFY_LAMBDA_ARN || !SCHEDULER_ROLE_ARN) {
    throw new Error(
      "NOTIFY_BIRTHDAYS_LAMBDA_ARN ou SCHEDULER_ROLE_ARN não configurados",
    );
  }
  const name = birthdayScheduleName(sub);
  const params = {
    Name: name,
    ScheduleExpression: CRON_8AM_DAILY,
    ScheduleExpressionTimezone: tz,
    FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
    State: ScheduleState.ENABLED,
    ActionAfterCompletion: ActionAfterCompletion.NONE,
    Target: {
      Arn: NOTIFY_LAMBDA_ARN,
      RoleArn: SCHEDULER_ROLE_ARN,
      Input: JSON.stringify({ ownerSub: sub }),
      RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 },
    },
  };

  let existing: { tz?: string } | null = null;
  try {
    const r = await client.send(new GetScheduleCommand({ Name: name }));
    existing = { tz: r.ScheduleExpressionTimezone };
  } catch (e) {
    const err = e as { name?: string };
    if (err.name !== "ResourceNotFoundException") throw e;
  }

  if (!existing) {
    await client.send(new CreateScheduleCommand(params));
    return "created";
  }
  if (existing.tz === tz) return "noop";
  await client.send(new UpdateScheduleCommand(params));
  return "updated";
}

export async function deleteBirthdaySchedule(sub: string): Promise<boolean> {
  const name = birthdayScheduleName(sub);
  try {
    await client.send(new DeleteScheduleCommand({ Name: name }));
    return true;
  } catch (e) {
    const err = e as { name?: string };
    if (err.name === "ResourceNotFoundException") return false;
    throw e;
  }
}
