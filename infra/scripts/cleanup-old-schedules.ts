/**
 * Removes all EventBridge Scheduler schedules with the old per-user prefix
 * ("lr-user-*"). Run this after Phase D (per-profile schedules) is fully
 * deployed and verified in production.
 *
 * Pre-requisitos:
 *   - Phase D ComputeStack deployed and notify-dose Lambda verified working.
 *   - AWS creds com permissão pra scheduler:ListSchedules e scheduler:DeleteSchedule.
 *   - Env: AWS_REGION (optional, defaults to us-east-1).
 *
 * Rodar (dry-run primeiro, sempre):
 *   cd infra
 *   AWS_REGION=us-east-1 npx -p tsx tsx scripts/cleanup-old-schedules.ts --dry-run
 *
 * Rodar (real):
 *   cd infra
 *   AWS_REGION=us-east-1 npx -p tsx tsx scripts/cleanup-old-schedules.ts
 *
 * Idempotente: pode rodar de novo com segurança — já-deletados são ignorados.
 */
import {
  SchedulerClient,
  ListSchedulesCommand,
  DeleteScheduleCommand,
} from "@aws-sdk/client-scheduler";

const DRY_RUN = process.argv.includes("--dry-run");
const REGION = process.env.AWS_REGION || "us-east-1";
const OLD_PREFIX = "lr-user-";

async function main(): Promise<void> {
  const client = new SchedulerClient({ region: REGION });

  if (DRY_RUN) {
    console.log("[dry-run] mode — nenhum schedule será apagado");
  }

  let token: string | undefined;
  let listed = 0;
  let deleted = 0;
  let skipped = 0;

  console.log(`→ listando schedules com prefixo "${OLD_PREFIX}" na região ${REGION}`);

  do {
    const res = await client.send(
      new ListSchedulesCommand({
        NamePrefix: OLD_PREFIX,
        NextToken: token,
        MaxResults: 100,
      }),
    );

    for (const s of res.Schedules ?? []) {
      const name = s.Name;
      if (!name) continue;
      listed++;

      if (DRY_RUN) {
        console.log(`  [dry-run] would delete: ${name}`);
        deleted++;
        continue;
      }

      try {
        await client.send(new DeleteScheduleCommand({ Name: name }));
        deleted++;
        if (deleted % 25 === 0) {
          console.log(`  apagados: ${deleted}`);
        }
      } catch (e) {
        const err = e as { name?: string };
        if (err.name === "ResourceNotFoundException") {
          // Already gone — that's fine.
          skipped++;
        } else {
          console.error(`  ✗ falhou ao apagar "${name}":`, e);
          throw e;
        }
      }
    }

    token = res.NextToken;
  } while (token);

  console.log("\n=== resumo ===");
  console.log(`schedules listados:   ${listed}`);
  if (DRY_RUN) {
    console.log(`schedules a apagar:   ${deleted} (dry-run — nenhum foi apagado)`);
  } else {
    console.log(`schedules apagados:   ${deleted}`);
    console.log(`já ausentes (skip):   ${skipped}`);
  }
}

main().catch((e) => {
  console.error("cleanup falhou:", e);
  process.exit(1);
});
