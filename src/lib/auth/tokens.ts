import "server-only";

import { getAuthSecret } from "@/lib/env";
import {
  generateSecureToken,
  hashIdentifierWithSecret,
  hashTokenWithSecret,
} from "./token-crypto";

export { generateSecureToken };

export function hashToken(token: string): string {
  return hashTokenWithSecret(getAuthSecret(), token);
}

export function hashIdentifier(value: string): string {
  return hashIdentifierWithSecret(getAuthSecret(), value);
}
