# Health checks

Two unauthenticated, read-only endpoints separate process health from dependency
readiness.

## Endpoints

| Endpoint | Purpose | Database access |
| --- | --- | --- |
| `GET /api/health` | Liveness: the application process can answer HTTP. | None. |
| `GET /api/health/ready` | Readiness: the application can perform a minimal database round trip. | `select 1` with a 5-second timeout. |

Both endpoints:

- return `Cache-Control: no-store`;
- return `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex`, and
  `Referrer-Policy: no-referrer`;
- accept or generate an `x-request-id` and return it.

Successful responses include the release commit when one is available. The
readiness failure response intentionally omits it.

### Liveness

```json
{ "status": "ok", "commit": "<sha>" }
```

`commit` is omitted when no release metadata is configured. Liveness never
touches the database or any external service.

### Readiness

Success:

```json
{ "status": "ready", "commit": "<sha>" }
```

Failure:

```json
{ "status": "unavailable" }
```

The failure response is intentionally minimal. It does not name the database,
the driver, the host, the error code, or the failing query, and it does not
include the commit field. Diagnostic detail is written to the server log as a
redacted `health.readiness_failed` event with the correlation ID.

The readiness probe is `src/server/services/health.ts`. It races a `select 1`
against a 5-second timer and throws a controlled timeout error. A connection
failure, authentication failure, or timeout all produce the same external 503.

## Recommended platform configuration

- Use `/api/health` for a lightweight liveness probe.
- Use `/api/health/ready` when deciding whether to send traffic to a new
  instance.
- Do not probe readiness at a high frequency; each check performs a real
  database round trip. A 30–60 second interval is usually sufficient.
- Do not cache either endpoint.
- Do not expose detailed dependency status, versions, environment names, or
  infrastructure identifiers through these routes.

Readiness checks are not failure-injection tests. Do not stop, restart, or
block the production database, or disconnect a protected Preview deployment, to
exercise the 503 path. Use unit tests and a disposable local database instead.
`tests/unit/health.test.ts` covers the liveness, ready, timeout/error, header,
request-ID, and redaction behaviour.

## Release verification

Health responses expose the exact source commit when one of these environment
variables contains a hexadecimal commit SHA:

1. `VERCEL_GIT_COMMIT_SHA` (set by Vercel)
2. `GITHUB_SHA` (set by GitHub Actions)
3. `BUILD_COMMIT_SHA` (manual fallback)
4. `NEXT_PUBLIC_BUILD_SHA` (manual fallback)

After a deployment, compare the health response with the expected commit:

```bash
npm run smoke:public -- --base https://your-deployment.example \
  --expected-sha "$(git rev-parse HEAD)"
```

This detects a stale deployment or a deployment of the wrong branch. A SHA is
build metadata, not a secret.

## Request correlation

The proxy matcher includes `/api/health` and `/api/health/ready`, so both
endpoints receive a correlation ID even if a caller does not supply one. A valid
inbound `x-request-id` is preserved; an invalid value is replaced. The same
value appears in the response header and in any server log record produced
while handling the request.
