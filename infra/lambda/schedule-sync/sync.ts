import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ListSchedulesCommand,
  FlexibleTimeWindowMode,
  ScheduleState,
} from "@aws-sdk/client-scheduler";

const PREFIX = "lr-";
const REGION = process.env.AWS_REGION || "us-east-1";
const NOTIFY_LAMBDA_ARN = process.env.NOTIFY_LAMBDA_ARN || "";
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN || "";

const client = new SchedulerClient({ region: REGION });

export type MedSpec = {
  sub: string;
  medId: string;
  times: string[];
  timezone: string;
  enabled: boolean;
};

export function nameFor(sub: string, medId: string, time: string): string {
  const cleanSub = sub.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
  const cleanMed = medId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 16);
  const cleanTime = time.replace(":", "");
  return `${PREFIX}${cleanSub}-${cleanMed}-${cleanTime}`;
}

function userPrefix(sub: string): string {
  const cleanSub = sub.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
  return `${PREFIX}${cleanSub}-`;
}

function medPrefix(sub: string, medId: string): string {
  const cleanSub = sub.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
  const cleanMed = medId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 16);
  return `${PREFIX}${cleanSub}-${cleanMed}-`;
}

async function listByPrefix(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListSchedulesCommand({ NamePrefix: prefix, NextToken: token, MaxResults: 100 }),
    );
    for (const s of res.Schedules ?? []) if (s.Name) out.push(s.Name);
    token = res.NextToken;
  } while (token);
  return out;
}

async function deleteSchedule(name: string): Promise<void> {
  try {
    await client.send(new DeleteScheduleCommand({ Name: name }));
  } catch (e) {
    const err = e as { name?: string };
    if (err.name !== "ResourceNotFoundException") throw e;
  }
}

async function createSchedule(
  sub: string,
  medId: string,
  time: string,
  timezone: string,
  enabled: boolean,
): Promise<void> {
  if (!NOTIFY_LAMBDA_ARN || !SCHEDULER_ROLE_ARN) {
    throw new Error("NOTIFY_LAMBDA_ARN ou SCHEDULER_ROLE_ARN não configurados");
  }
  const [h, m] = time.split(":").map(Number);
  const expr = `cron(${m} ${h} * * ? *)`;
  const name = nameFor(sub, medId, time);
  await client.send(
    new CreateScheduleCommand({
      Name: name,
      ScheduleExpression: expr,
      ScheduleExpressionTimezone: timezone,
      FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
      State: enabled ? ScheduleState.ENABLED : ScheduleState.DISABLED,
      Target: {
        Arn: NOTIFY_LAMBDA_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({ sub, medId, time }),
        RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 120 },
      },
    }),
  );
}

export async function syncMed(spec: MedSpec): Promise<{ created: string[]; deleted: string[] }> {
  const existing = await listByPrefix(medPrefix(spec.sub, spec.medId));
  const desired = new Map(spec.times.map((t) => [nameFor(spec.sub, spec.medId, t), t]));

  const toDelete = existing.filter((n) => !desired.has(n));
  const toCreate: string[] = [];

  await Promise.all(toDelete.map(deleteSchedule));

  for (const [name, time] of desired) {
    if (existing.includes(name)) continue;
    await createSchedule(spec.sub, spec.medId, time, spec.timezone, spec.enabled);
    toCreate.push(name);
  }

  return { created: toCreate, deleted: toDelete };
}

export async function deleteAllForMed(sub: string, medId: string): Promise<string[]> {
  const existing = await listByPrefix(medPrefix(sub, medId));
  await Promise.all(existing.map(deleteSchedule));
  return existing;
}

export async function deleteAllForUser(sub: string): Promise<string[]> {
  const existing = await listByPrefix(userPrefix(sub));
  await Promise.all(existing.map(deleteSchedule));
  return existing;
}

export async function recreateForMed(
  sub: string,
  medId: string,
  times: string[],
  timezone: string,
  enabled: boolean,
): Promise<void> {
  await deleteAllForMed(sub, medId);
  if (!enabled) return;
  for (const time of times) {
    await createSchedule(sub, medId, time, timezone, enabled);
  }
}
