import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { getAuthSecret } from "@/lib/env";

export function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHmac("sha256", getAuthSecret()).update(token).digest("hex");
}

export function hashIdentifier(value: string): string {
  return createHmac("sha256", getAuthSecret())
    .update(`id:${value}`)
    .digest("hex");
}
