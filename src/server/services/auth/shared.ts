import { users } from "@/db/schema";
import type { CreatedSession } from "@/lib/auth/session";
import { getAppUrl } from "@/lib/env";
import { ValidationError } from "@/lib/errors";
import { validatePasswordStrength } from "@/lib/validation/auth";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "authorized_user";
  accountStatus: "invited" | "active" | "deactivated";
  lastLoginAt: Date | null;
};

export type AuthResult = {
  user: PublicUser;
  session: CreatedSession;
};

export type SessionMeta = {
  ipHash?: string | null;
  userAgent?: string | null;
};

export type UserRow = typeof users.$inferSelect;

export function publicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    accountStatus: user.accountStatus,
    lastLoginAt: user.lastLoginAt,
  };
}

export function activationUrl(token: string): string {
  return `${getAppUrl()}/activate?token=${encodeURIComponent(token)}`;
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function assertStrongPassword(password: string): void {
  const problem = validatePasswordStrength(password);
  if (problem) {
    throw new ValidationError(problem, { password: [problem] });
  }
}
