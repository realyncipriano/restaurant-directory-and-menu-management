import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

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
    include: ["tests/unit/**/*.test.ts"],
    env: {
      AUTH_SECRET: "unit-test-only-auth-secret-do-not-use",
    },
  },
});
