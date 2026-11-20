import { AsyncLocalStorage } from "node:async_hooks";

// Next's server-only testing utilities expect this global outside the Next
// runtime (Vitest runs in plain Node).
const globalWithAsyncLocalStorage = globalThis as typeof globalThis & {
  AsyncLocalStorage?: typeof AsyncLocalStorage;
};
globalWithAsyncLocalStorage.AsyncLocalStorage ??= AsyncLocalStorage;

process.env.TZ = "UTC";
