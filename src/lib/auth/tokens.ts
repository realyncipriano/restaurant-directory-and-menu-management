import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
