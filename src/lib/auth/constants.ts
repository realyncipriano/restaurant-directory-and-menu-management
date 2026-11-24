export const SESSION_COOKIE = "rdmm_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export const MFA_CHALLENGE_COOKIE = "rdmm_mfa";
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;

export const STEP_UP_TTL_SECONDS = 10 * 60;

export const DEFAULT_SESSION_IDLE_TTL_SECONDS = 24 * 60 * 60;
export const MIN_SESSION_IDLE_TTL_SECONDS = 5 * 60;
export const SESSION_LAST_USED_THROTTLE_SECONDS = 5 * 60;

/**
 * The idle timeout is configurable but can never exceed the absolute session
 * lifetime. Invalid or missing values fall back to the 24-hour default.
 */
export function getSessionIdleTtlSeconds(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.SESSION_IDLE_TIMEOUT_MINUTES?.trim();
  const minutes = raw && /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : NaN;
  const seconds = Number.isFinite(minutes)
    ? minutes * 60
    : DEFAULT_SESSION_IDLE_TTL_SECONDS;

  return Math.min(
    Math.max(seconds, MIN_SESSION_IDLE_TTL_SECONDS),
    SESSION_TTL_SECONDS,
  );
}
