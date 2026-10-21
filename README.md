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
   - Optional `R2_*` and `EXTRACTION_*` values (see below)

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

Destructive tests never target the development database by default.

`npm run test:integration` requires all of:

- `TEST_DATABASE_URL` pointing to a dedicated disposable database or Neon branch
- `ALLOW_DESTRUCTIVE_DB_TESTS=1`
- a normalized host/database that differs from `DATABASE_URL`,
  `DATABASE_URL_DIRECT`, and the `NEON_BRANCH_URL_*` values

The guard is implemented in `src/db/safety.ts` and checked both by the
verification script and at runtime inside tests. Without it, integration tests
skip and no database is modified.

Migrations are additive. The migration script refuses to modify a database that
contains tables but has no Drizzle migration journal, and it never drops tables
or resets data. `npm run test:db` uses an ephemeral in-process Postgres (PGlite)
to validate migrations and constraints without connecting to any configured
database.

## Testing

```bash
npm run lint
npm run typecheck
npm test          # unit tests
npm run test:db   # migrations + constraints on ephemeral PGlite
npm run test:integration  # only with a verified disposable test database
```

## Optional integrations

### Cloudflare R2

Uploads and private source scans are disabled until these are set:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_BASE_URL` for public images only

Private menu scans are never served from the public bucket URL. The app proxies
authorized access to short-lived signed URLs.

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
3. Process the scan. Extraction stages items with confidence, duplicate, and
   change flags; page images remain private and are previewed through
   authorized, short-lived signed URLs.
4. Accept, reject, or edit each staged item, then apply accepted items to the
   draft. Omitted scan items never delete existing menu items, and unpriced
   accepted items block application.
5. Review the draft and publish it through the normal versioned publish flow.

Scan uploads use a Server Action body limit of 85 MB (configured in
`next.config.ts`). If your hosting platform enforces a smaller request body
limit, upload fewer or smaller pages per scan.

## Administrator bootstrap

- No public registration.
- No default credentials.
- The seed command refuses weak passwords, existing administrators, and existing
  users, and does not log the password.
- Administrators invite authorized users with single-use, expiring activation
  links.

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

## Deployment

The app is Vercel-compatible and requires Node.js runtime for database, Argon2,
sharp, and extraction work. Configure all environment variables in the hosting
provider, run migrations against the production database from a trusted
environment, then build and deploy. Do not deploy using test credentials.

No deployment is performed automatically by this repository.
