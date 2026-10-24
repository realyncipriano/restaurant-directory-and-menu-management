export function serializeJsonLd(value: unknown): string {
  const serialized = JSON.stringify(value);
  return (serialized ?? "null").replace(/</g, "\\u003c");
}
