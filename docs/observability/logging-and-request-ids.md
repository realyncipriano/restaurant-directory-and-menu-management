# Structured logging and request IDs

## What is logged

Server code writes one JSON object per line through
`src/lib/observability/logger.ts`. A record contains:

| Field | Meaning |
| --- | --- |
| `timestamp` | ISO-8601 time the record was created. |
| `level` | `debug`, `info`, `warn`, or `error`. |
| `service` | Stable service name (`restaurant-directory`). |
| `environment` | `VERCEL_ENV`, then `NODE_ENV`, then `unknown`. |
| `event` | Short machine-readable event name, for example `health.readiness_failed`. |
| `release` | Exact source commit when the platform exposes one (see below). |
| `requestId` | Correlation ID for the request, when one is available. |
| `message` | Optional human-readable summary. |
| `error` | Optional serialized error: `name`, `category`, `code`, `status`, `digest`, `message`, `stack`. |
| `context` | Optional selected fields supplied by the caller. |

`LOG_LEVEL` controls the minimum level. It defaults to `info`. Set it to
`debug` temporarily when diagnosing a non-production environment.

## Request IDs

`src/lib/observability/request-id.ts` owns generation and validation:

- Generated IDs use the form `req_<uuid>`.
- An inbound `x-request-id` is reused only when it matches
  `^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`.
- Missing or malformed inbound values are replaced with a generated ID.

The proxy:

- resolves the ID at the start of every matched request;
- forwards it to downstream handlers through the request headers;
- returns it on proxied `NextResponse.next()` responses;
- returns it on redirects, 404s, and 503s that the proxy creates itself.

Health route handlers also accept or generate a request ID and return it on the
response. Server actions, services, and background import work use
`AsyncLocalStorage` (`src/lib/observability/request-context.ts`) or the
`headers()` fallback (`src/lib/observability/server-context.ts`) so a record can
be correlated without threading the value through every function.

Request IDs are diagnostic correlation values only. They are never
authentication, authorization, CSRF, or rate-limit identities. A caller may
choose the value, so code must not make a security decision from it.

## Error classification

`classifyError()` maps errors to stable categories:

`validation`, `authentication`, `authorization`, `not_found`, `conflict`,
`rate_limited`, `database`, `network`, `timeout`, `storage`,
`external_service`, `configuration`, and `unknown`.

Classification uses the application error types first, then walks the `cause`
chain and uses error names, codes, and HTTP status values. Database failures
wrapped by Drizzle are classified from the underlying driver error, so a
database outage is distinguishable from a validation error or a storage failure
without logging a query or connection string.

Drizzle query errors embed the SQL text and parameters in the wrapper message.
The logger never serialises that wrapper: it records `DrizzleQueryError` plus
the cause's sanitised message, stack, and code, and it drops `query` and
`params` entirely. If a wrapper has no cause, its message and stack are omitted
rather than risk logging query data.

## Redaction and data minimisation

`src/lib/observability/redact.ts` is defence in depth, not a licence to log
sensitive input. It:

- removes connection strings, Sentry-style DSNs, URLs with embedded
  credentials, bearer tokens, JWTs, email addresses, cookie values, and common
  `password=...` / `token=...` patterns;
- replaces values under sensitive keys such as `password`, `secret`, `token`,
  `cookie`, `authorization`, `dsn`, `connectionString`, and `session`;
- truncates long strings, arrays, objects, and stacks;
- handles circular structures without throwing.

Callers must still avoid passing raw request bodies, form data, headers,
cookies, authorization values, database URLs, reset links, invitation links, or
extraction-provider payloads. Log identifiers and selected status fields
instead. The proxy's existence-check failure log explicitly disables error
message and stack output so a failing slug or connection detail cannot leak.

## Event examples

- `proxy.public_existence_check_failed` – public restaurant/menu lookup failed;
  the proxy returns a retryable 503.
- `health.readiness_failed` – the readiness database probe failed; the route
  returns 503 without dependency details.
- `db.pool_error` – the database pool emitted an error. The pool name is
  included; the message is redacted.
- `storage.object_delete_failed` and `storage.private_object_delete_failed` –
  best-effort object cleanup failed.
- `imports.menu_import_completed`, `imports.menu_import_failed`,
  `imports.failed_import_cleanup_failed` – import processing outcome and
  correlation.
- `imports.page_image_failed` and `imports.deleted_page_image_failed` –
  authenticated page-image routes failed unexpectedly.
- `request.unhandled_error` – Next.js `onRequestError` last-resort reporting.
  The request path and headers are deliberately not logged because paths can
  contain reset or invitation tokens and headers contain cookies.

## Release metadata

`deploymentCommitSha()` reads the first valid hexadecimal value from:

1. `VERCEL_GIT_COMMIT_SHA`
2. `GITHUB_SHA`
3. `BUILD_COMMIT_SHA`
4. `NEXT_PUBLIC_BUILD_SHA`

Vercel sets the first value automatically. Other deployments should set
`BUILD_COMMIT_SHA` in the build/runtime environment. The value is build
metadata, not a secret; it is safe to expose through health responses and smoke
reports.

## Viewing logs

JSON lines are intended for the hosting platform's log viewer or a forwarding
agent. Local development prints the same records to the terminal. If logs are
forwarded to a third-party service, review its retention and data-residency
settings and disable request-body capture.

## Tests

`tests/unit/request-id.test.ts`, `tests/unit/observability-logger.test.ts`,
`tests/unit/health.test.ts`, `tests/unit/proxy.test.ts`, and
`tests/unit/public-smoke.test.ts` cover generation, propagation, replacement,
redaction, classification, health behaviour, and the public smoke runner.
