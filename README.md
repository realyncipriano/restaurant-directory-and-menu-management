# Restaurant Directory & Menu Management

A public restaurant directory with a private, permission-scoped management
console for maintaining published menus and prices.

## Status

The public directory, authentication, restaurant and menu management, image
storage, AI-assisted menu import/review workflows, an administrator audit log,
and site-wide settings are implemented. There is no demo restaurant data: public
content is created only through the management console.

## Stack

- Next.js 16 App Router (Cache Components), React 19, TypeScript
- Tailwind CSS 4
- Neon PostgreSQL + Drizzle ORM
- Cloudflare R2 through the S3-compatible API
- Zod validation
- Argon2id password hashing, opaque database-backed sessions
- Vitest (unit, ephemeral PGlite schema tests, gated Neon integration tests)

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` from `.env.example` and fill in:

   - `DATABASE_URL` (pooled Neon URL) and `DATABASE_URL_DIRECT` (direct URL)
   - `AUTH_SECRET` (32+ random bytes)
   - Optional `SESSION_IDLE_TIMEOUT_MINUTES` (defaults to 1440), `R2_*`, and
     `EXTRACTION_*` values (see below)

3. Inspect the migration target (read-only):

   ```bash
   npm run db:preflight
   ```

4. Generate migrations when the schema changes, then apply them:

   ```bash
   npm run db:generate
   npm run db:migrate
   ```

5. Seed the first administrator (explicit credentials only, no defaults):

   ```bash
   # Set ADMIN_EMAIL and ADMIN_PASSWORD in your environment or .env.local first.
   npm run db:seed:admin
   ```

6. Start the app:

   ```bash
   npm run dev
   ```

## Database safety

Destructive tests fail closed. They never target the development database by
default.

`npm run test:integration` requires all of:

- `TEST_DATABASE_URL` pointing to a dedicated disposable database or Neon branch
- `ALLOW_DESTRUCTIVE_DB_TESTS=1`
- at least one comparison URL from `DATABASE_URL`, `DATABASE_URL_DIRECT`,
  `NEON_BRANCH_URL_POOLED`, `NEON_BRANCH_URL_DIRECT`, or `DEV_DATABASE_URLS`
- a normalized host/database that differs from every comparison URL

Hostnames are compared case-insensitively with trailing dots removed. The
guard parses the connection string the same way the database driver does, so
IPv4 shorthand, octal, and hexadecimal forms (`127.1`, `0177.0.0.1`,
`2130706433`, `0x7f000001`), IDN spellings, and IPv6 spellings compare
canonically. Database names follow the driver's two-stage percent decoding and
are compared case-insensitively. Changing only the port does not make an
otherwise identical target safe. Query parameters that would override the
target host (`host` or `hostaddr`) are rejected. Recognized Neon `ep-*`
hostnames are compared by endpoint and region, so a `-pooler` host and its
direct counterpart are treated as the same endpoint; different endpoint IDs
remain distinct. A `.neon.tech` hostname that does not contain a recognizable
endpoint and region fails closed instead of falling back to a string
comparison.

The guard is implemented once in `src/db/safety.ts`. The verification script,
Vitest global setup, and each integration test module run it before opening a
database connection, applying migrations, or truncating tables. A missing,
invalid, or development-identical target fails the run with a diagnostic and no
database is modified. Integration tests do not skip silently when the guard
rejects the target. Comparison is syntactic: a custom hostname that resolves to
the same server is not detected by DNS resolution.

Migrations are additive. The migration script refuses to modify a database that
contains tables but has no Drizzle migration journal, and it never drops tables
or resets data. `npm run test:db` uses an ephemeral in-process Postgres (PGlite)
to validate migrations and constraints without connecting to any configured
database.

## Testing

The suites use three separate Vitest configurations:

| Command | Configuration | Scope |
| --- | --- | --- |
| `npm test` / `npm run test:watch` | `vitest.unit.config.mts` | Unit tests in `tests/unit`; no database or external services. |
| `npm run test:db` | `vitest.db.config.mts` | Migrations and constraints in `tests/db` using an in-process PGlite database. Does not use `.env.local` or require Neon credentials. |
| `npm run test:integration` | `vitest.config.mts` | Guarded Neon integration tests in `tests/integration`; fails before connecting unless the target is a verified disposable database, then may migrate it. |

`vitest.config.mts` is also the default Vitest configuration, so a bare
`npx vitest` runs the guarded integration suite rather than the unit or PGlite
suites. Direct Vitest invocations use the same fail-closed global setup and
cannot bypass the test-database safety check. Use the npm scripts above.

Run linting, type checking, unit tests, PGlite tests, and a production build in
one step:

```bash
npm run verify
```

`verify` does not run the Neon integration suite or require an external test
database. Run `npm run test:integration` separately, and only after configuring
the safeguards in [Database safety](#database-safety).

Public smoke checks are read-only HTTP checks and are not part of `verify`
because they need a running deployment:

```bash
npm run smoke:public -- --base http://localhost:3000 \
  --restaurant your-restaurant-slug --menu your-menu-slug
```

## Continuous integration

GitHub Actions runs `.github/workflows/ci.yml` for pull requests and pushes to
`master`. It installs from `package-lock.json` with `npm ci` on Node.js 24 and
runs:

- `npm run lint`
- `npx next typegen` (generate route types for the type-check)
- `npm run typecheck`
- `npm test` (unit tests)
- `npm run test:db` (ephemeral PGlite schema tests)
- `npm run build`

`next typegen` runs before type-checking because Next.js generates route
helpers such as `LayoutProps` into `.next/types`; without it, a clean CI
checkout cannot type-check.

The ordinary workflow does not run `npm run test:integration` and does not
require Neon, R2, extraction-provider, or production credentials. The unit and
PGlite suites use their own test-only `AUTH_SECRET` values and do not connect to
a configured database.

### Dependency audit

CI also runs `npm audit --omit=dev --audit-level=high` in report-only mode
(`continue-on-error`). At the time this workflow was introduced, this
production-dependency audit reported 0 vulnerabilities. A full `npm audit`
reported 11 moderate findings in development-only tooling:
`drizzle-kit`/`esbuild` (GHSA-67mh-4wv8-2f99) and
`typescript-eslint`/`minimatch` (GHSA-g3hv-75wg-m249). These are outside the
production dependency set and are not fixed automatically. A failing audit does
not block a merge while the baseline is reviewed. Do not add `npm audit fix`,
`npm audit fix --force`, or unrelated dependency upgrades to the workflow.
Triage findings, open a scoped remediation change, and make the step blocking
only after the baseline is clean and the change is approved.

### Dependabot

`.github/dependabot.yml` checks npm packages and GitHub Actions weekly. Minor and
patch updates are grouped; major updates remain separate pull requests and
require manual review. Dependabot does not auto-merge.

### Branch protection

Branch protection is a GitHub repository setting, not a repository file. After
the workflow has run on a pull request, configure `master` to:

- Require pull requests.
- Require the `Quality checks` status check from the `CI` workflow (shown in
  some views as `CI / Quality checks`).
- Require branches to be up to date before merging.
- Dismiss stale approvals.
- Block force pushes and branch deletion.
- Include administrators where supported.

These settings are intentionally not changed by this repository. The guarded
Neon integration suite remains a separate, manually configured workflow.

## Optional integrations

### Cloudflare R2

Public image uploads are disabled until these are set:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_BASE_URL` for public images only

Menu scan uploads additionally require `R2_PRIVATE_BUCKET`, a separate bucket
that is not publicly readable. Scans are never served from the public bucket
URL: the browser uploads directly with short-lived presigned PUT URLs, and
authorized previews use short-lived signed GET URLs. Configure the private
bucket's CORS policy to allow `PUT`, `GET`, and `HEAD` from your `APP_URL`
origin, with `content-type` allowed and `ETag` exposed.

### Menu extraction

Extraction is disabled unless `EXTRACTION_PROVIDER=openai`,
`EXTRACTION_API_KEY`, and (optionally) `EXTRACTION_BASE_URL` /
`EXTRACTION_MODEL` are configured. The adapter targets any OpenAI-compatible
vision endpoint. When disabled, the upload UI explains that scanning is
unavailable and manual menu entry remains fully functional.

OCR/AI usage may be metered by your provider. No extraction result is ever
published automatically; every import must be reviewed and explicitly applied.

### Scan workflow

1. Open a restaurant's menus and choose **Scan a menu**.
2. Select a draft menu and upload up to 10 JPEG/PNG/WebP pages (8 MB each).
   The browser uploads each page directly to the private bucket using
   short-lived presigned URLs, so scan pages do not pass through a Server
   Action body limit.
3. Process the scan. Extraction stages items with confidence, duplicate, and
   change flags; page images remain private and are previewed through
   authorized, short-lived signed URLs. A stalled import can be retried after
   15 minutes, up to 3 processing attempts.
4. Accept, reject, or edit each staged item, then apply accepted items to the
   draft. Omitted scan items never delete existing menu items, and unpriced
   accepted items block application.
5. Review the draft and publish it through the normal versioned publish flow.

Restaurant and menu image Server Actions use a body limit of 8 MB (configured
in `next.config.ts`). If your hosting platform enforces a smaller request body
limit, upload smaller images.

## Administrator bootstrap

- No public registration.
- No default credentials.
- The seed command refuses weak passwords, existing administrators, and existing
  users, and does not log the password.
- Administrators invite authorized users with single-use, expiring activation
  links.

### Promotion and demotion

Administrators manage roles from **Users** (`/dashboard/users`). An active
authorized user can be promoted to administrator, and an administrator can have
that access removed after a confirmation prompt. You cannot change your own
role, and the last active administrator cannot be demoted or deactivated. Role
changes, deactivations, password-reset link issuance, and invitation creation
or renewal share a transaction-level advisory lock, and each rechecks the
acting administrator under that lock. Concurrent requests therefore cannot
remove the final active administrator or act on stale administrator access.
Every role change is audited as `user_role_changed` with the previous and new
role. Roles are read from the database on each request, so changes apply
immediately without signing the user out.

### Sole-administrator recovery

`db:seed:admin` is bootstrap-only: it refuses to run when an administrator
already exists. If an existing administrator is locked out, issue a one-hour,
single-use password-reset link from a trusted machine with direct database
access:

```bash
RECOVER_ADMIN_EMAIL="admin@example.com" \
RECOVER_ADMIN_CONFIRM=1 \
npm run db:recover:admin
```

The command requires `AUTH_SECRET` (32+ characters), `APP_URL`, and a direct
database URL through the normal environment or `.env.local`. It validates every
value before connecting, reports the database target only as a masked host and
name, and never prints credentials or `AUTH_SECRET`. The pool is always closed.

`APP_URL` must be an `https:` URL with a public-looking hostname. The validator
enforces a reserved-address policy: localhost, loopback, private, link-local,
multicast, documentation, IPv4-compatible (`::/96`), IPv4-translated
(`::ffff:0:0:0/96`), and prohibited IPv4-mapped IPv6 forms are rejected,
including alternate textual forms and trailing-dot hostnames. This is a
conservative syntactic policy, not a claim that every accepted address is
universally routable or that it eliminates every SSRF risk. For local
development only, set `NODE_ENV=development` and
`RECOVER_ADMIN_ALLOW_DEV_URL=1` to allow a local `http:` URL. The opt-in is
rejected when `NODE_ENV` is missing, production, or unexpected, so an ambiguous
environment fails closed. Hostname checks do not perform DNS resolution, so an
accepted hostname can still resolve elsewhere; keep `APP_URL` under operator
control and point it at the real public deployment.

> **The recovery token is printed to standard output.** It is not written to
> the application log or audit details, but the CLI output contains the token
> itself. Terminal scrollback, shell recording, CI job logs, `tee`, and copied
> text can retain it. Clear or secure those records after delivering the link.

The recovery link is stored only as a hash, expires after one hour, can be used
once, and is recorded in the audit log as `admin_recovery_link_created` with the
source `cli`. Resetting the password revokes all of that administrator's
existing sessions. The command refuses non-administrators, invited or
deactivated accounts, and accounts without a password; it never promotes or
reactivates anyone. There is no unauthenticated recovery route and no email
delivery, so deliver the printed link over a secure channel and do not paste it
into shared logs.

The recovery command has the same trust boundary as the seed and migration
commands: anyone with direct database credentials can already modify users.
The audit entry is a record of the operation, not a defense against someone who
controls the database.

## Audit history and settings

Administrators get two extra dashboard areas:

- **Audit history** (`/dashboard/audit`) lists recorded actions (sign-ins,
  permission changes, restaurant and menu edits, publishes, imports, settings)
  newest first, with filters for action, entity type, and actor email, plus
  pagination. Non-administrators cannot read it.
- **App settings** (`/dashboard/settings`) edits the public site name, tagline,
  and optional support email. Values are stored in the database, cached per
  request, and shown on public and dashboard layouts.

Audit rows and settings are written transactionally with the action that caused
them. No secret (passwords, tokens, raw IP addresses) is ever stored in the audit
log.

## Architecture

- `src/app` – public, auth, and dashboard routes
- `src/db` – Drizzle schema, client, safety guards, migrations
- `src/lib` – environment, auth, permissions, money, storage, extraction
- `src/server` – authorized services and read queries
- `tests/unit`, `tests/db`, `tests/integration` – test suites

Published menus are versioned. Editing a published menu creates a draft
revision; the live menu changes only when an authorized user explicitly
publishes the revision. Price changes are recorded in the change log.

## Observability and health

Server code emits structured JSON logs with levels, stable event names,
redacted error details, and request IDs. Request IDs are generated or accepted
by the proxy, forwarded to downstream handlers, returned in the
`x-request-id` response header, and carried through server actions and import
processing. They are correlation values only, never authentication.

- `GET /api/health` is a liveness check and does not touch the database.
- `GET /api/health/ready` performs a minimal `select 1` with a 5-second timeout
  and returns a controlled `503` when the database is unavailable.
- Both endpoints return `no-store` and do not disclose dependency or
  infrastructure details.

See [Observability documentation](docs/observability/README.md) for logging
fields, redaction rules, health-check operations, the provider-neutral
error-tracking decision, and the public/authenticated smoke-testing policy.

## Deployment

The app is Vercel-compatible and requires Node.js runtime for database, Argon2,
sharp, and extraction work. Configure all environment variables in the hosting
provider, set `TRUST_PROXY=vercel` on Vercel (or `proxy` behind your own trusted
reverse proxy), run migrations against the production database from a trusted
environment, then build and deploy. Do not deploy using test credentials.

No deployment is performed automatically by this repository.
