import { and, eq, gt, inArray, isNull } from "drizzle-orm";

import { authTokens, users } from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { generateSecureToken, hashToken } from "@/lib/auth/tokens";

export type AuthTokenPurpose = "invite" | "password_reset";

export async function findUsableToken(
  db: DbExecutor,
  rawToken: string,
  purposes: AuthTokenPurpose[],
  now: Date,
) {
  const token = rawToken.trim();
  if (token.length < 20 || token.length > 200) return null;

  const [row] = await db
    .select({
      tokenId: authTokens.id,
      purpose: authTokens.purpose,
      expiresAt: authTokens.expiresAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      accountStatus: users.accountStatus,
      passwordHash: users.passwordHash,
    })
    .from(authTokens)
    .innerJoin(users, eq(authTokens.userId, users.id))
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        inArray(authTokens.purpose, purposes),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row) return null;

  if (row.purpose === "invite" && row.accountStatus !== "invited") {
    return null;
  }
  if (row.purpose === "password_reset" && row.accountStatus !== "active") {
    return null;
  }

  return row;
}

export async function markTokenUsed(
  db: DbExecutor,
  tokenId: string,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(and(eq(authTokens.id, tokenId), isNull(authTokens.usedAt)))
    .returning({ id: authTokens.id });
  return Boolean(row);
}

export async function invalidateUserTokens(
  db: DbExecutor,
  userId: string,
  now: Date,
): Promise<void> {
  await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(and(eq(authTokens.userId, userId), isNull(authTokens.usedAt)));
}

export async function issueToken(
  db: DbExecutor,
  input: {
    userId: string;
    purpose: AuthTokenPurpose;
    createdBy: string | null;
    expiresAt: Date;
    now: Date;
  },
): Promise<string> {
  const token = generateSecureToken();
  await db.insert(authTokens).values({
    userId: input.userId,
    purpose: input.purpose,
    tokenHash: hashToken(token),
    expiresAt: input.expiresAt,
    createdBy: input.createdBy,
    createdAt: input.now,
  });
  return token;
}
