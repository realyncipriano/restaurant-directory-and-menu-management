import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const devUrls = [
  process.env.DATABASE_URL,
  process.env.DATABASE_URL_DIRECT,
  process.env.NEON_BRANCH_URL_POOLED,
  process.env.NEON_BRANCH_URL_DIRECT,
]
  .map((value) => value?.trim())
  .filter((value): value is string => Boolean(value));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@",
        replacement: fileURLToPath(new URL("./src", import.meta.url)),
      },
      {
        find: "server-only",
        replacement: fileURLToPath(
          new URL("./tests/mocks/server-only.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: "node",
    fileParallelism: false,
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/integration/global-setup.ts"],
    env: {
      DEV_DATABASE_URLS: devUrls.join(","),
    },
    include: ["tests/**/*.test.ts"],
  },
});
