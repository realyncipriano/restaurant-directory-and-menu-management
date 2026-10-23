export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const STALE_PROCESSING_MS = 15 * 60 * 1000;
export const MAX_PROCESSING_ATTEMPTS = 3;

export const ALLOWED_SOURCE_MIME = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
