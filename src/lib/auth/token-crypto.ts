import { createHmac, randomBytes } from "node:crypto";

/**
 * Script-safe token cryptography.
 *
 * This module intentionally has no `server-only` dependency so maintenance
 * scripts (for example, administrator recovery) can hash tokens exactly the
 * same way the application does.
 */
export function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashTokenWithSecret(secret: string, token: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function hashIdentifierWithSecret(
  secret: string,
  value: string,
): string {
  return createHmac("sha256", secret)
    .update(`id:${value}`)
    .digest("hex");
}
