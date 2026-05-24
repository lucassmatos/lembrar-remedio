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

### 0. Maintenance window / write freeze (MANDATORY)

Open a **maintenance window and freeze writes** to the app BEFORE the COPY
phase, and hold it until AFTER the new code is deployed and verified (step 6).

Why this is required: the live old app reads and writes the `user#` partition.
The migration COPYs that data into the `profile#` partition and then DELETEs the
originals. Once DELETE wipes `user#`, the old app serves empty data, and any
writes that happened during the window land in a partition that is about to be
(or already) deleted — those writes are silently lost. A write freeze (put the
app in read-only / maintenance mode, or take it offline) is the only safe way to
guarantee no data is lost across the cutover.

Do not lift the freeze until step 6 confirms the new code is healthy.

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

### 6. Verify the new code, then lift the write freeze

Smoke-test the deployed app against real profiles (list profiles, view a
reminder, mark a dose). Only once the new code is confirmed healthy should you
lift the maintenance window / write freeze from step 0.

### 7. Prime profile schedules (MANDATORY)

Existing profiles do **not** get an `lr-profile-*` EventBridge schedule until a
reminder changes — so freshly migrated profiles will not fire notifications
until then. After deploy, run a one-shot that calls `updateProfileSchedule` for
every profile-meta sentinel (`profile#<id>/meta`), creating the per-profile
schedule for all existing profiles.

Alternative (less reliable): the first `notify-dose` invocation self-reschedules
the profile, but this only covers profiles that already had a schedule from the
old per-user flow — do not depend on it for profiles that never had one. Prefer
the explicit one-shot above.

### 8. Cleanup old per-user schedules (MANDATORY)

After step 7, remove the old per-user EventBridge Scheduler schedules
(`lr-user-*`) replaced by per-profile schedules (`lr-profile-*`). Always run the
dry-run first (see "Cleanup old schedules" below).

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

## Cleanup old schedules

This is step 8 above and is **mandatory**, not optional. After Phase D is fully
deployed and verified in production (and schedules primed in step 7), remove the
old per-user EventBridge Scheduler schedules (`lr-user-*`) that were replaced by
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
