/**
 * Migra os schedules antigos (lr-{sub}-{med}-{HHMM}, um por dose) pro modelo
 * novo (lr-user-{sub}, um por usuário, ONE_TIME, self-rescheduling).
 *
 * Pre-requisitos:
 *   - Stack ComputeStack já deployada com o notify-user Lambda novo
 *   - AWS creds com permissão pra scheduler:* e dynamodb:Query/Get/Put
 *   - Envs: NOTIFY_USER_LAMBDA_ARN, SCHEDULER_ROLE_ARN, DDB_TABLE_NAME
 *
 * Rodar:
 *   cd infra
 *   NOTIFY_USER_LAMBDA_ARN=arn:aws:lambda:... \
 *     SCHEDULER_ROLE_ARN=arn:aws:iam::... \
 *     DDB_TABLE_NAME=lembrar-remedio \
 *     npx ts-node scripts/migrate-to-user-schedules.ts
 *
 * Idempotente: pode rodar de novo, vai pular o que já está no formato novo.
 */
import {
  SchedulerClient,
  ListSchedulesCommand,
  DeleteScheduleCommand,
} from "@aws-sdk/client-scheduler";
import { listAllUsers } from "../../lib/ddb";
import { updateUserSchedule, userScheduleName } from "../lambda/schedule-sync/user-schedule";

async function main(): Promise<void> {
  const region = process.env.AWS_REGION || "us-east-1";
  const sched = new SchedulerClient({ region });

  console.log("→ listando schedules antigos");
  let token: string | undefined;
  let deletedOld = 0;
  let keptNew = 0;
  do {
    const res = await sched.send(
      new ListSchedulesCommand({ NamePrefix: "lr-", NextToken: token, MaxResults: 100 }),
    );
    for (const s of res.Schedules ?? []) {
      const name = s.Name;
      if (!name) continue;
      if (name.startsWith("lr-user-")) {
        keptNew++;
        continue;
      }
      await sched.send(new DeleteScheduleCommand({ Name: name }));
      deletedOld++;
      if (deletedOld % 25 === 0) console.log(`  apagados: ${deletedOld}`);
    }
    token = res.NextToken;
  } while (token);
  console.log(`✓ ${deletedOld} schedules antigos apagados, ${keptNew} novos preservados`);

  console.log("→ listando usuários");
  const users = await listAllUsers();
  console.log(`  ${users.length} usuários`);

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let noop = 0;
  for (const u of users) {
    try {
      const result = await updateUserSchedule(u.sub);
      const label = `${u.email ?? u.sub} → ${userScheduleName(u.sub)}`;
      switch (result.action) {
        case "created":
          created++;
          console.log(`  + ${label} (at ${new Date(result.nextAt).toISOString()})`);
          break;
        case "updated":
          updated++;
          console.log(`  ~ ${label} (at ${new Date(result.nextAt).toISOString()})`);
          break;
        case "deleted":
          deleted++;
          console.log(`  - ${label}`);
          break;
        case "noop":
          noop++;
          break;
      }
    } catch (e) {
      console.error(`✗ falhou pra ${u.sub}:`, e);
    }
  }

  console.log("\n=== resumo ===");
  console.log(`schedules antigos apagados: ${deletedOld}`);
  console.log(`usuários processados:       ${users.length}`);
  console.log(`  schedules criados:        ${created}`);
  console.log(`  schedules atualizados:    ${updated}`);
  console.log(`  schedules deletados:      ${deleted}`);
  console.log(`  no-op (sem chat/reminder): ${noop}`);
}

main().catch((e) => {
  console.error("migração falhou:", e);
  process.exit(1);
});
