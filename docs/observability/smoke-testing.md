# Smoke-testing policy

Smoke tests are split into two deliberately separate groups:

1. **Public HTTP checks** – automated, read-only, no credentials.
2. **Authenticated browser checks** – manual for now, using disposable data in
   an authorized environment.

Keeping them separate prevents a public availability check from requiring a
test account, and prevents an authenticated publishing test from mutating
production.

## Public HTTP smoke checks

The runner is `scripts/smoke-public.ts`, exposed as:

```bash
npm run smoke:public -- --base http://localhost:3000
```

It sends only `GET` requests with a fixed `user-agent`, does not follow
redirects, does not send cookies or authorization headers, and does not mutate
data. It records only a safe allowlist of response headers.

### Checks

| ID | Expected |
| --- | --- |
| `homepage` | `200` HTML with baseline security headers. |
| `restaurant-document` | `200` HTML for a known public restaurant slug. |
| `menu-document` | `200` HTML for a known published menu slug. |
| `missing-restaurant-404` | Genuine `404` with `no-store`, `noindex`, and `nosniff`, and no reflected slug or connection detail. |
| `invalid-slug-404` | Invalid restaurant and menu slugs are rejected with `404`. |
| `login-page` | `200` sign-in page with `no-store` and `nosniff`. |
| `dashboard-redirect` | Unauthenticated `/dashboard` redirects to `/login` with a safe `next` path and a request ID. |
| `health-liveness` | `200` with `{ "status": "ok" }`, `no-store`, and a request ID. |
| `health-readiness` | `200` with `{ "status": "ready" }` after the minimal database probe. |
| `request-id-propagation` | A valid sentinel `x-request-id` is returned unchanged. |
| `deployment-commit` | Both health responses report the expected commit. |

A restaurant or menu slug that is not configured marks that check `BLOCKED`,
not `FAIL`. Use `--require-documents` (or `SMOKE_REQUIRE_DOCUMENTS=1`) to make
blocked document checks exit with code `2` in an environment where slugs must be
provided.

### Options

| Option | Environment variable | Purpose |
| --- | --- | --- |
| `--base <url>` | `SMOKE_BASE_URL` | Base URL. Defaults to `http://localhost:3000`. |
| `--expected-sha <sha>` | `SMOKE_EXPECTED_SHA` | Compare the deployed commit with the expected commit. |
| `--restaurant <slug>` | `SMOKE_RESTAURANT_SLUG` | Known public restaurant slug. |
| `--menu <slug>` | `SMOKE_MENU_SLUG` | Known published menu slug. |
| `--output <file>` | `SMOKE_OUTPUT` | Write the JSON report to an explicit path. |
| `--require-documents` | `SMOKE_REQUIRE_DOCUMENTS` | Return exit code `2` when documents are blocked. |
| – | `SMOKE_TIMEOUT_MS` | Per-request timeout in milliseconds. Defaults to 10 seconds. |

The base URL must be absolute `http(s)` and must not contain embedded
credentials.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No failures. Blocked checks are allowed unless document checks are required. |
| `1` | At least one check failed. |
| `2` | Documents were required but blocked, or the runner could not start. |

### Interpreting results

- A `FAIL` on an error-header check is a release blocker: the proxy may be
  leaking a slug, a connection string, or a generic Next.js error page.
- A readiness `FAIL` means the deployment cannot reach its database. Do not
  retry aggressively; investigate the database and deployment configuration.
- A `deployment-commit` `FAIL` usually means the tested URL is a stale
  deployment or the wrong branch. Confirm the URL before treating it as an
  application bug.
- A `BLOCKED` document check is not evidence that the page works. Supply known
  public slugs before marking a release verified.

The report contains generated IDs, status codes, a small set of response
headers, and body lengths. It never contains cookies, authorization headers,
request bodies, or the full HTML. Write it only to an explicit path; do not
commit local reports by default.

## Authenticated checks

These checks are intentionally **manual and separate** from the public runner.
They require a real session and, for publishing or deletion, mutate data. Run
them only against a disposable environment with disposable test data.

Manual checklist:

| Check | Preconditions and steps | Expected result | Cleanup |
| --- | --- | --- | --- |
| Login | Use the dedicated account on `/login`. | Dashboard loads; the session cookie is `HttpOnly` and is never copied into output. | Sign out. |
| Dashboard redirect | While signed out, request `/dashboard` and `/dashboard/restaurants`. | `307` to `/login` with a same-origin `next` path; no open redirect. | None. |
| Administrator-only access | Sign in as a non-admin and request `/dashboard/users`; repeat as an admin. | Non-admin is redirected away; admin sees the user-management page. Server actions also reject non-admin callers. | None. |
| Menu publishing | In the disposable restaurant, create or edit a draft, then publish it. | Public menu changes only after explicit publish; unpublished edits stay private. | Delete the disposable menu. |
| Version history | Edit a published menu, then inspect the version/history view. | A new draft revision is created; the published version and change log remain correct. | Delete the disposable versions/menu. |
| Import review | Run an import with the disposable provider/test fixture, review items, accept or reject a subset. | Nothing is published automatically; decisions and counts match the review UI. | Delete the import and staged items. |
| Deleted menus | Delete a disposable menu. | It disappears publicly and appears only in the authorized deleted view; restore/delete actions are permission-checked. | Purge the disposable record. |
| Deleted scans | Delete a disposable import/scan, then open its page previews. | Deleted list and signed previews respect ownership/admin access; pages are not public. | Purge the disposable records and objects. |

Record only pass/fail, status codes, and resource names. Do not record cookies,
session values, CSRF values, signed URLs, or provider keys.

Rules:

- Never print cookies, session tokens, CSRF values, or authorization headers in
  command output, screenshots, reports, or issue comments.
- Do not run publishing, deletion, or import-mutation checks against production
  or a protected Preview deployment.
- Use a dedicated test account and test restaurant. Do not reuse a real user's
  credentials or data.
- Clean up disposable data through the application or the approved test-data
  reset procedure.

## Playwright decision

Playwright is **not installed**. Browser automation remains deferred.

Reasons:

- It adds browser binaries, a test runner, CI time, and selector maintenance.
- Authenticated tests need seeded users, restaurants, imports, and menus, plus
  reliable cleanup.
- The highest-risk public behaviours are already covered by dependency-free
  HTTP checks and unit tests.
- Running mutation tests against production would be unsafe, so a disposable
  environment is required before browser automation has value.

Adopt Playwright only if the team can provide all of the following:

- a disposable, automatically seeded environment;
- a dedicated test account with storage state generated at runtime;
- a policy that never prints or commits the storage state;
- stable accessible selectors and a small, high-value scenario set;
- an agreed CI budget and a plan for flaky-test triage.

## Failure-path testing

Readiness and proxy 503 behaviour must not be exercised by disrupting
production or a protected Preview database. Use:

- `tests/unit/health.test.ts` for readiness success, failure, timeout, headers,
  and redaction;
- `tests/unit/proxy.test.ts` for existence-check failures and 503 responses;
- a disposable local or explicitly authorized database if an end-to-end outage
  check is needed.

## Release verification sequence

1. Deploy the exact commit to the target environment.
2. Run the public smoke checks with `--expected-sha` set to that commit.
3. Confirm the health endpoints return the same commit.
4. Run the authenticated checklist only where mutation is authorized.
5. Record the report path and the commands used. Do not commit credentials or
   local reports unless the team explicitly decides to retain them.
