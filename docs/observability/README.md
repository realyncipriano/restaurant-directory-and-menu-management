# Observability

This directory documents the production-readiness observability layer:

- [Structured logging and request IDs](./logging-and-request-ids.md)
- [Health checks](./health-checks.md)
- [Error tracking decision](./error-tracking.md)
- [Smoke testing policy](./smoke-testing.md)

The implementation is deliberately provider-neutral. It writes structured JSON
to standard output/error, exposes read-only health endpoints, and keeps error
reporting behind the existing logger and Next.js `onRequestError` hook. No
third-party error-tracking SDK is installed.
