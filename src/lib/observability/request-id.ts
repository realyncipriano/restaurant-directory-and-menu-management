export const REQUEST_ID_HEADER = "x-request-id";

// Request IDs are diagnostic correlation values only. They are never used for
// authentication or authorization, and a caller-supplied value must not be
// treated as proof of identity.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function createRequestId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return `req_${randomUuid}`;
  }

  // Node.js 20+ and every supported browser expose crypto.randomUUID(). Keep a
  // defensive fallback for unusual runtimes, but never use this value as a
  // secret or security token.
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return `req_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function requestIdFromHeaders(headers: {
  get(name: string): string | null;
}): string {
  const value = headers.get(REQUEST_ID_HEADER);
  return isRequestId(value) ? value : createRequestId();
}
