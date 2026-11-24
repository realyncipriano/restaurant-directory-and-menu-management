# Error-tracking decision

## Decision

No third-party error-tracking provider is installed in Phase 2.

The application now produces structured, redacted logs and reports unhandled
server errors through Next.js `onRequestError`. That is the provider-neutral
seam. Adding Sentry, GlitchTip, or another service requires an explicit
decision, a data-protection review, and approval before a dependency, DSN,
build plugin, or environment variable is added.

This document records the evaluation and the design that a future integration
must follow. Pricing is indicative list pricing observed during the Phase 2
evaluation (November 2026); re-check current plans, quotas, taxes, and data
regions before purchase.

## Options considered

### Sentry

- **Cost:** Free Developer plan in the region of 5,000 errors/month; Team plan
  in the region of US$26/month for 50,000 errors. Confirm current pricing.
- **Next.js compatibility:** Official Next.js SDK with App Router support,
  server-component and route-handler instrumentation, source-map upload, and
  release/environment tagging. This is the lowest-integration-risk option.
- **Vercel compatibility:** First-party Vercel integration and documented
  source-map/build configuration.
- **Data residency:** SaaS data regions (including EU) and a self-hosted
  option. Region choice must be made before sending any event.
- **PII handling:** Powerful scrubbing hooks, but the default integration can
  collect request data if it is not restricted. `sendDefaultPii` must be off,
  request bodies/cookies must not be sent, and `beforeSend` must scrub.
- **Free-tier limits:** Roughly 5,000 errors/month on the free Developer plan;
  quota exhaustion can drop events unless spike protection and alerting are
  configured.
- **Alerting:** Mature issue alerts, spike protection, and notification
  integrations.

### GlitchTip

- **Cost:** Free plan in the region of 1,000 events/month; Small plan in the
  region of US$15/month for 100,000 events. Self-hosting is possible.
- **Next.js compatibility:** Accepts Sentry-compatible events, so the Sentry
  SDK can often be pointed at a GlitchTip DSN. Next.js-specific features such
  as source-map handling, release health, and performance tracing are less
  complete and must be verified against the chosen version.
- **Vercel compatibility:** Works as an external DSN endpoint from Vercel
  functions, but there is no equivalent first-party Vercel integration. Build
  and source-map upload need manual configuration.
- **Data residency:** Managed EU hosting in Germany is available; self-hosting
  gives full control but adds operational cost.
- **PII handling:** Same fundamental obligation as Sentry: disable default PII,
  avoid request bodies, and scrub before send. The smaller feature set means
  fewer built-in controls, so scrubbing must live in application code.
- **Free-tier limits:** Roughly 1,000 events/month, which is tight for a
  production launch; the Small plan raises the limit substantially.
- **Alerting:** Basic alerting and integrations exist, but the ecosystem and
  Next.js-specific guidance are smaller than Sentry's.

## Comparison

| Criterion | Sentry | GlitchTip |
| --- | --- | --- |
| Up-front cost | Free tier; paid Team plan | Lower-cost free and Small plans |
| Next.js fit | Official SDK and guidance | Sentry-compatible; verify feature gaps |
| Vercel fit | First-party integration | External DSN only |
| Data residency | SaaS region choice plus self-host | EU (Germany) managed hosting plus self-host |
| PII controls | Rich scrubbing and filtering | Application-level scrubbing is essential |
| Free-tier volume | About 5k errors/month | About 1k events/month |
| Alerting | Mature | Basic but sufficient for small teams |

Both are viable. Sentry has the lowest integration and Next.js compatibility
risk. GlitchTip has lower cost and a straightforward EU/self-hosted story. The
right choice depends on budget, data-residency requirements, and willingness to
operate or verify a smaller integration.

## Provider-neutral design

Any future adapter must consume the existing structured events rather than
sprinkling provider SDK calls through route handlers and services.

1. **Single seam.** Extend `src/lib/observability/logger.ts` (or add one adapter
   module behind it) to forward selected records. Route handlers and services
   keep calling `logger.*` and do not import a provider SDK directly.
2. **Explicit opt-in.** The adapter is disabled unless a DSN and an explicit
   enable flag are configured. No DSN belongs in the repository or in
   `.env.example` as a real value.
3. **Minimum payload.** Send the event name, level, release, environment,
   request ID, error name/category/code/status, and selected non-sensitive
   context. Never send request headers, cookies, authorization values, request
   bodies, form data, database URLs, reset/invitation links, or extraction
   payloads.
4. **Scrub twice.** Keep the existing redaction, and configure the provider's
   `beforeSend`/scrubbing hook as a second layer. Set `sendDefaultPii` to false
   and disable automatic request-body and cookie capture.
5. **Release and environment.** Use `deploymentCommitSha()` for the release and
   the same environment name as the logs. This makes an error traceable to an
   exact deployment.
6. **Sampling and quotas.** Define an error-event sample rate, a per-project
   quota, and spike protection before launch. Log forwarding failures locally;
   never let an error-tracking outage break a request.
7. **Alerting.** Alert on new error categories, a sustained increase in
   `request.unhandled_error`, repeated `health.readiness_failed` events, and
   import failures. Route alerts to the on-call owner with a runbook link.
8. **Residency and retention.** Choose the region before the first event,
   document the retention period, and include the provider in the data
   inventory. Review any subprocessors.
9. **Source maps.** If source maps are uploaded, keep them private, upload only
   from trusted CI, and never serve them publicly.
10. **Verification.** Test with a disposable project and a synthetic event.
    Confirm that a fake password, cookie, bearer token, connection string, and
    email address never appear in the provider UI. Confirm that disabling the
    adapter produces no outbound requests.

## What would trigger the decision

Adopt a provider when at least one of these is true:

- production traffic makes manual log review insufficient;
- an incident requires grouped stack traces and alerting;
- the team needs release-to-release error trends;
- a compliance or customer requirement mandates a specific retention or
  residency arrangement.

Until then, the structured logs plus the `onRequestError` hook provide
correlation and incident evidence without a new vendor, dependency, or data
flow.
