import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

import { collectDevUrls } from "./src/db/safety";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const devUrls = collectDevUrls(process.env);

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
    pool: "threads",
    fileParallelism: false,
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/integration/global-setup.ts"],
    env: {
      DEV_DATABASE_URLS: devUrls.join(","),
    },
    include: ["tests/integration/**/*.test.ts"],
  },
});
