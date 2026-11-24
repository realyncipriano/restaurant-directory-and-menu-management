import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  /**
   * Correlation value only. It is never proof of identity and must never be
   * used for authentication, authorization, or rate-limit decisions.
   */
  requestId: string | null;
  route?: string;
  method?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}
