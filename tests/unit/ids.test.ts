import { describe, expect, it } from "vitest";

import { normalizeUuid } from "@/lib/validation/ids";

const CANONICAL = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("normalizeUuid", () => {
  it.each([
    ["canonical", CANONICAL],
    ["uppercase", CANONICAL.toUpperCase()],
    ["unhyphenated", CANONICAL.replaceAll("-", "")],
    ["braced", `{${CANONICAL}}`],
    ["uppercase braced", `{${CANONICAL.toUpperCase()}}`],
    ["URN", `urn:uuid:${CANONICAL}`],
    ["uppercase URN", `URN:UUID:${CANONICAL.toUpperCase()}`],
    ["whitespace padded", `  ${CANONICAL}\t`],
  ])("normalizes the %s form", (_label, value) => {
    expect(normalizeUuid(value)).toBe(CANONICAL);
  });

  it.each([
    "",
    "not-a-uuid",
    "3f2504e04f8941d39a0c0305e82c330",
    "3f2504e0-4f89-41d3-9a0c-0305e82c3301-extra",
    "g32504e0-4f89-41d3-9a0c-0305e82c3301",
    "{3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    "urn:uuid:",
    "00000000-0000-4000-8000-00000000000z",
  ])("rejects malformed value %j", (value) => {
    expect(normalizeUuid(value)).toBeNull();
  });
});
