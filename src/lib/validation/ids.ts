const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Normalizes the UUID forms PostgreSQL accepts (canonical, uppercase,
 * unhyphenated, braced, and URN) to the canonical lowercase representation.
 *
 * The application uses this before comparing identifiers so equivalent
 * representations cannot bypass identity checks such as self-target guards.
 */
export function normalizeUuid(value: string): string | null {
  let candidate = value.trim().toLowerCase();

  if (candidate.startsWith("urn:uuid:")) {
    candidate = candidate.slice("urn:uuid:".length);
  }
  if (candidate.startsWith("{") && candidate.endsWith("}")) {
    candidate = candidate.slice(1, -1);
  }
  if (/^[0-9a-f]{32}$/.test(candidate)) {
    candidate = [
      candidate.slice(0, 8),
      candidate.slice(8, 12),
      candidate.slice(12, 16),
      candidate.slice(16, 20),
      candidate.slice(20),
    ].join("-");
  }

  return CANONICAL_UUID.test(candidate) ? candidate : null;
}
