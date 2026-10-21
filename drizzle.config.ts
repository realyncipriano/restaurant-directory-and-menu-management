import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const url =
  process.env.DATABASE_URL_DIRECT?.trim() ||
  process.env.NEON_BRANCH_URL_DIRECT?.trim() ||
  process.env.DATABASE_URL?.trim();

if (!url) {
  throw new Error(
    "DATABASE_URL_DIRECT or DATABASE_URL is required for Drizzle Kit commands.",
  );
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  strict: true,
  verbose: true,
  dbCredentials: { url },
});
