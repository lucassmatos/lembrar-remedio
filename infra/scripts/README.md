# Migration runbook: profile-scoped partitions

Migrates DynamoDB data from `user#<sub>/(reminder|log|notified)#*` to
`profile#<profileId>/...` partitions. This is a prerequisite before deploying
Phase C/D code (API rewire + Lambda rewire).

## Pre-flight

- Confirm Phase C/D code is **NOT** yet deployed to production.
- Take a DynamoDB **on-demand backup** in the AWS console. **This is required.**
  There is no in-place rollback after DELETE completes.
- Set environment variables:
  ```
  export AWS_PROFILE=<your-profile>
  export DDB_TABLE_NAME=lembrar-remedio   # or your table name
  export AWS_REGION=us-east-1             # adjust if different
  ```
- Note: `tsx` is **not** a project dependency. Use `npx -p tsx tsx ...` to run
  the script, or install it globally first (`npm i -g tsx`).

## Steps

### 1. Dry-run COPY — estimate scope

```bash
npx -p tsx tsx infra/scripts/migrate-profiles-to-shared.ts --dry-run --phase=copy
```

Review the output — each line is one item that would be written. Eyeball counts
per user.

### 2. COPY (idempotent, safe to interrupt and re-run)

```bash
npx -p tsx tsx infra/scripts/migrate-profiles-to-shared.ts --phase=copy
```

Each user's config is stamped with `migrationCopyDone` when complete. Re-running
skips already-stamped users.

### 3. VERIFY — confirm every reminder is in the new partition

```bash
npx -p tsx tsx infra/scripts/migrate-profiles-to-shared.ts --phase=verify
```

Throws on the first mismatch. Fix before continuing (re-run COPY if needed).

### 4. DELETE — remove old `user#<sub>/(reminder|log|notified)#*` items

```bash
npx -p tsx tsx infra/scripts/migrate-profiles-to-shared.ts --phase=delete
```

Each user's config is stamped with `migrationDone` when complete.

### 5. Deploy Phase C/D

Deploy the new web app + CDK stacks (Phase C API rewire + Phase D Lambda rewire).
The new code reads only `profile#*` partitions — data is now in place.

## Running all phases at once (non-production environments)

```bash
npx -p tsx tsx infra/scripts/migrate-profiles-to-shared.ts
# equivalent to --phase=all
```

## Rollback

**Before DELETE is run:** the script is fully idempotent. Re-run COPY + VERIFY
as many times as needed.

**After DELETE:** restore from the DynamoDB on-demand backup taken at the start.
There is no in-place rollback once originals are deleted.

## Post-deploy cleanup

After Phase D is fully deployed and verified in production, remove the old
per-user EventBridge Scheduler schedules (`lr-user-*`) that were replaced by
per-profile schedules (`lr-profile-*`).

### Dry-run (always run this first)

```bash
cd infra
AWS_REGION=us-east-1 npx -p tsx tsx scripts/cleanup-old-schedules.ts --dry-run
```

Review the output — each line is one schedule that would be deleted. Confirm
the count looks right (one per active user that had reminders).

### Real run

```bash
cd infra
AWS_REGION=us-east-1 npx -p tsx tsx scripts/cleanup-old-schedules.ts
```

The script paginates via `NextToken`, handles `ResourceNotFoundException`
(already-deleted schedules) gracefully, and prints a summary at the end.
It is idempotent — safe to re-run.
