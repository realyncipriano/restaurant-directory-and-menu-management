import { safeRedirectPath } from "../action-state";
import { STEP_UP_TTL_SECONDS } from "./constants";

/**
 * Step-up freshness is stored on the session, so it ends when the session is
 * revoked or expires. A missing timestamp is always stale.
 */
export function isStepUpFresh(
  steppedUpAt: Date | null | undefined,
  now = new Date(),
): boolean {
  if (!steppedUpAt) return false;
  return now.getTime() - steppedUpAt.getTime() < STEP_UP_TTL_SECONDS * 1000;
}

/**
 * Prevents a verified session from bouncing back to the verification page,
 * which would otherwise loop when `next` points at step-up itself.
 */
export function safeStepUpNext(value: string | null | undefined): string {
  const next = safeRedirectPath(value);
  return next === "/dashboard/step-up" ||
    next.startsWith("/dashboard/step-up?") ||
    next.startsWith("/dashboard/step-up#")
    ? "/dashboard"
    : next;
}
