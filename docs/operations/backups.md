# Backups and disaster recovery

This runbook covers encrypted database backups, integrity checks, restore
drills, and recovery from data loss. It applies to the application schema in
`src/db/schema` and every deployment that uses the same database.

## Scope and guarantees

A backup is a logical snapshot of all 19 application tables:

- users, restaurants, restaurant permissions
- menus, categories, items, variants, modifiers
- imports, import pages, import items, change logs
- app settings, audit logs
- sessions, MFA challenges, MFA recovery codes, auth tokens, rate limits

The snapshot is read in one repeatable-read, read-only transaction, so every
table sees the same database snapshot. Rows are sorted by primary key, encoded
losslessly, checksummed per table, gzipped, and encrypted with AES-256-GCM. The
file name contains the creation time and an 8-character ciphertext
fingerprint.

Restore validates the format, table set, columns, row counts, and checksums
before writing. It then inserts rows in foreign-key order, topologically orders
self-references (`menus.cloned_from_menu_id` and
`menu_import_items.duplicate_of_import_item_id`), and re-reads every table
inside the restore transaction. Any mismatch rolls the entire restore back.

Targets for this service:

| Metric | Target | How it is met |
| --- | --- | --- |
| RPO | 24 hours | Daily local backup plus an offsite copy. Run more often if the business requires a smaller window. |
| RTO | 2 hours | Rehearsed restore into a fresh database, migration check, smoke test, and cutover. |
| Retention | 30 days, at least 3 copies | `BACKUP_RETENTION_DAYS=30`, `BACKUP_MIN_COPIES=3`. Offsite retention is configured separately. |

A logical backup is not point-in-time recovery. If the hosting plan provides
Neon PITR, use it for incidents measured in minutes. Keep these encrypted
backups for portability, offsite copies, and protection against account-level
or region-level loss.

Not included in a backup:

- Cloudflare R2 objects (restaurant images, import source pages). The database
  stores object keys only.
- Environment variables and platform configuration (`AUTH_SECRET`,
  `MFA_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY`, Vercel settings).
- The Drizzle migration journal. Apply migrations at the backup's commit before
  restoring; `npm run db:restore -- --migrate` does this for an empty target.

## One-time setup

1. Generate a backup encryption key:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

2. Store the key in a password manager and configure it as:

   - `BACKUP_ENCRYPTION_KEY` in `.env.local` for local/operator backups
   - a Vercel Production secret if a platform job will create backups
   - a GitHub Actions repository secret if the optional workflow is enabled

3. Do not commit the key, print it, paste it into an issue, or place it in a
   command-line argument. `.env.local` and `backups/` are gitignored.

4. Record where the key is stored and who can retrieve it. Losing this key makes
   every existing backup unrecoverable.

> `BACKUP_ENCRYPTION_KEY` is separate from `MFA_ENCRYPTION_KEY`. Restored TOTP
> secrets remain readable only if the application still uses the original
> `MFA_ENCRYPTION_KEY`.

There is no automatic key-rotation tool. Keep old keys for as long as old
backups are retained. Rotating the key without re-encrypting existing files
makes those files unreadable.

## Create a backup

```bash
npm run db:backup
```

The default source is `DATABASE_URL_DIRECT` (falling back to `DATABASE_URL`).
Prefer the direct Neon endpoint; the script warns when the pooled endpoint is
used. Backups are written to `backups/` with mode `0600` where the platform
supports it.

Options:

```bash
# Write to a different directory.
npm run db:backup -- --out D:\secure\rdmm-backups

# Use the gated disposable test database instead of the development database.
npm run db:backup -- --test

# Skip retention pruning for this run.
npm run db:backup -- --no-prune
```

Configuration:

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKUP_OUTPUT_DIR` | `backups` | Local encrypted output directory |
| `BACKUP_RETENTION_DAYS` | `30` | Delete backups older than this. `0` disables pruning. |
| `BACKUP_MIN_COPIES` | `3` | Always keep this many newest backups, even if older than the cutoff |
| `BACKUP_MAX_AGE_HOURS` | `26` | Freshness threshold for `db:backup:check` |

The source database must have a Drizzle migration journal. The backup records
the journal count so a restore cannot silently land on a different schema.

## Verify a backup

Run after every backup, and at least daily when backups are scheduled:

```bash
npm run db:backup:check
```

This decrypts the newest file, revalidates every row checksum, prints metadata,
and fails when the backup is older than `BACKUP_MAX_AGE_HOURS`. Check a specific
file with:

```bash
npm run db:backup:check -- --file backups/rdmm-backup-20260115T120000123Z-1a2b3c4d.rdmm.enc
```

Run the local restore drill after backup/restore code changes, after schema
migrations, and at least monthly:

```bash
npm run db:restore:drill
```

The drill needs no credentials and never touches a configured database. It
seeds every table in an in-process PGlite database, exports, encrypts, writes
and reads the encrypted file, decrypts, rejects a tampered copy, restores into
a second empty PGlite database, verifies all checksums, and confirms a second
restore is rejected.

Quarterly, also restore a real backup into a disposable Neon branch or database:

```bash
# Required in the current shell, in addition to BACKUP_ENCRYPTION_KEY:
#   RESTORE_DATABASE_URL=<direct URL to the disposable target>
#   RESTORE_CONFIRM=RESTORE
#   ALLOW_DESTRUCTIVE_DB_TESTS=1
npm run db:restore -- --file backups/<file>.rdmm.enc --migrate
```

Record the date, backup file name, operator, and result in the operations log.
Do not skip the drill because a backup file exists; an unexercised restore is
not a recovery plan.

## Restore procedure

Use this when data is lost or corrupted and a logical restore is required.
Never point `RESTORE_DATABASE_URL` at production or at a shared development or
test database. The CLI refuses targets that match any configured application,
development, or test URL.

### 1. Declare and contain

- Declare an incident and name an operator.
- Stop writes: take the application offline or remove the production alias.
  Application-level read-only mode is not sufficient.
- Preserve the damaged database for investigation. Do not delete it.
- Identify the most recent backup that is known to be good.

### 2. Verify the chosen backup

```bash
npm run db:backup:check -- --file backups/<file>.rdmm.enc
```

If decryption or checksums fail, try the next-newest copy. Do not restore a
corrupt or tampered file.

### 3. Create an empty restore target

Create a new empty database in the Neon project, or an empty branch. An empty
database is required: the restore refuses to write into a database that already
has rows in any application table. Record its direct (non-pooled) connection
string.

### 4. Check out the matching code

Check out the commit recorded in the backup (`commit` is printed by the restore
command) so the local `drizzle/` folder matches the backup schema. If the
backup commit is unavailable, use a later commit and expect the migration-count
guard to reject the restore.

### 5. Restore

Set the guards in the current shell. In PowerShell:

```powershell
$env:RESTORE_DATABASE_URL = "postgresql://.../rdmm_restore?sslmode=require"
$env:RESTORE_CONFIRM = "RESTORE"
$env:ALLOW_DESTRUCTIVE_DB_TESTS = "1"
npm run db:restore -- --file backups/<file>.rdmm.enc --migrate
```

In bash:

```bash
export RESTORE_DATABASE_URL="postgresql://.../rdmm_restore?sslmode=require"
export RESTORE_CONFIRM="RESTORE"
export ALLOW_DESTRUCTIVE_DB_TESTS="1"
npm run db:restore -- --file backups/<file>.rdmm.enc --migrate
```

`--migrate` applies the local migrations to the empty target before restoring.
Omit it only when the target already has the exact migration count recorded in
the backup.

The restore command:

- refuses a non-empty target, a mismatched migration count, a pooled Neon
  endpoint, or a target that matches a configured application/test URL
- restores all tables in one transaction and verifies checksums inside it
- deletes restored sessions, auth tokens, and MFA challenges by default, so
  stolen or stale credentials cannot be replayed (override only for forensics
  with `--keep-sessions`)
- prints the next operational steps without printing credential values

### 6. Verify before cutover

- The command reports matching row counts and verified checksums.
- Spot-check recent restaurants, menus, settings, and an administrator login.
- Confirm the row counts are close to the expected time window. A restore
  loses writes made after the backup.
- If `MFA_ENCRYPTION_KEY` is missing or was rotated, MFA-enabled users cannot
  complete TOTP login. Restore the original key or have administrators re-enroll
  through the account page or the sole-administrator recovery procedure.

### 7. Cut over

- Update the Vercel Production `DATABASE_URL` and `DATABASE_URL_DIRECT` to the
  restored database (pooled and direct forms respectively).
- Keep `MFA_ENCRYPTION_KEY` unchanged.
- Redeploy or restart so the application opens new connections.
- Run the public smoke checks:

  ```bash
  npm run smoke:public -- --base-url https://<production-host>
  ```

- Sign in as an administrator and confirm MFA step-up, settings, and a
  disposable menu edit.

### 8. Close out

- Confirm sessions and auth tokens are revoked. Users must sign in again.
- Review the audit-log gap between the backup time and the incident. Correlate
  with platform and proxy logs where possible.
- Reconcile R2 object keys. Restored rows may reference images that were
  deleted or are unavailable.
- If compromise is suspected, rotate database credentials, `AUTH_SECRET`, and
  any platform tokens, then redeploy.
- Take a fresh backup of the recovered database.
- Document the timeline, backup used, data loss window, and follow-up actions.

## Offsite copies

A backup on the same machine as the application is not disaster recovery. Keep
at least one copy outside the application host and the database provider.

- The GitHub Actions workflow (`.github/workflows/backup.yml`) creates an
  encrypted backup and uploads it as an Actions artifact. It runs daily at
  02:00 UTC and can also be dispatched manually. It is gated by:
  - repository variable `BACKUP_ENABLED=true`
  - secret `BACKUP_DATABASE_URL` (direct Neon connection string)
  - secret `BACKUP_ENCRYPTION_KEY`
- A failed backup or freshness check fails the workflow run. Confirm that the
  people who respond to incidents receive GitHub Actions notifications, and add
  external alerting if a missed run is unacceptable. Remove the `schedule`
  block to pause automated backups.
- Download important artifacts to an encrypted vault or password-manager file
  store. Artifact retention is not the same as disaster-recovery retention.
- Never upload unencrypted backups to a public bucket, issue tracker, chat, or
  email. The encrypted file is still sensitive: it contains password hashes,
  MFA state, audit records, and personal data.

A simple local schedule on Windows Task Scheduler:

```powershell
powershell -NoProfile -Command "Set-Location 'C:\xampp\htdocs\restaurant_directory_and_menu_management'; npm run db:backup"
```

For cron:

```cron
0 2 * * * cd /srv/restaurant-directory && /usr/bin/npm run db:backup >> /var/log/rdmm-backup.log 2>&1
```

Schedule `npm run db:backup:check` after each backup and alert on failure. A
backup pipeline that fails silently is worse than no pipeline, because it
creates false confidence.

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `BACKUP_ENCRYPTION_KEY must be at least 32 characters` | Key missing or too short | Set the real key in `.env.local` or the environment |
| `looks like a placeholder` | Example key copied from `.env.example` | Generate a random key and store it securely |
| `Backup could not be decrypted` | Wrong key, wrong file, or corruption | Try the key from the password manager; try another copy |
| `checksum verification failed` | File corrupted or modified | Discard it and use another backup |
| `without a Drizzle migration journal` | Wrong database or migrations never applied | Confirm the target; run `npm run db:migrate` or `--migrate` |
| `Target schema has N applied migrations but the backup was taken at M` | Code/migrations do not match the backup | Check out the backup commit or use a matching backup |
| `Refusing to restore into a non-empty database` | Target already has data | Create a fresh empty database; do not truncate production |
| `reference cycle` or `references a row that is not in the backup` | Corrupt or inconsistent snapshot | Use another backup; report the issue |
| `post-restore verification failed` | Insert normalization or a code defect | The transaction rolled back; do not cut over |
| `Latest backup is ... hours old` | Schedule failed or key missing | Fix the schedule and create a backup immediately |
| Warning about a pooled Neon endpoint | `DATABASE_URL` was used instead of `DATABASE_URL_DIRECT` | Set the direct URL for backups |

## Drill log

Record each drill in the operations log:

| Date | Type | Backup file | Operator | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-11-25 | synthetic | `n/a` (ephemeral) | automation | pass | 19 tables / 23 rows; tamper rejection; verified restore; second-restore rejection. Real-source drill still pending valid disposable credentials. |
| YYYY-MM-DD | synthetic / real | file name or `n/a` | name | pass/fail | follow-ups |
