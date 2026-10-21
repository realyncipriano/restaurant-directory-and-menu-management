import "./load-env";

import { Pool } from "@neondatabase/serverless";
import { hash } from "@node-rs/argon2";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq, sql } from "drizzle-orm";

import { getDirectDatabaseUrl } from "../src/lib/db-url";
import {
  attachPoolErrorHandler,
  sanitizeDbError,
} from "../src/db/pool-errors";
import { maskConnectionString } from "../src/db/safety";
import { auditLogs, users } from "../src/db/schema";

const WEAK_PASSWORDS = new Set([
  "password",
  "password123",
  "admin",
  "admin123",
  "administrator",
  "changeme",
  "letmein",
  "qwerty123",
  "123456789012",
]);

function validate(email: string, password: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("ADMIN_EMAIL must be a valid email address.");
  }
  if (!password || password.length < 12) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters long.");
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    throw new Error("ADMIN_PASSWORD is a well-known weak password. Choose another.");
  }
  const localPart = email.split("@")[0]?.toLowerCase();
  if (localPart && password.toLowerCase().includes(localPart)) {
    throw new Error("ADMIN_PASSWORD must not contain the email local part.");
  }
  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ].filter(Boolean).length;
  if (classes < 3) {
    throw new Error(
      "ADMIN_PASSWORD must include at least three of: lowercase, uppercase, number, symbol.",
    );
  }
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Administrator seed requires explicit ADMIN_EMAIL and ADMIN_PASSWORD. No defaults are used and no account was created.",
    );
  }
  validate(email, password);

  const url = getDirectDatabaseUrl();
  console.log(`Admin seed target: ${maskConnectionString(url)}`);

  const pool = new Pool({ connectionString: url });
  attachPoolErrorHandler(pool, "seed-admin");
  const db = drizzle(pool, { schema: { users, auditLogs } });

  try {
    const existingAdmin = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "admin"))
      .limit(1);
    if (existingAdmin.length > 0) {
      throw new Error(
        "An administrator already exists. This seed command will not overwrite or create additional administrators.",
      );
    }

    const existingUser = await db
      .select({ id: users.id, accountStatus: users.accountStatus })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (existingUser.length > 0) {
      throw new Error(
        "A user with that email already exists. Refusing to overwrite it.",
      );
    }

    const passwordHash = await hash(password, {
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });

    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          name: "Administrator",
          email,
          passwordHash,
          role: "admin",
          accountStatus: "active",
        })
        .returning({ id: users.id, email: users.email });

      if (!created) {
        throw new Error("Failed to create administrator.");
      }

      await tx.insert(auditLogs).values({
        actorId: created.id,
        actorEmail: created.email,
        action: "admin_seeded",
        entityType: "user",
        entityId: created.id,
        details: { source: "cli" },
      });
    });

    console.log(`Administrator created for ${email}.`);
    console.log(
      "Sign in at /login. The password was not logged; store it securely.",
    );
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(sanitizeDbError(error));
  process.exitCode = 1;
});
