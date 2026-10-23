import { describe, expect, it } from "vitest";

import { slugWithSuffix, slugify } from "@/lib/slug";

describe("slug helpers", () => {
  it("normalizes accents, punctuation, and whitespace", () => {
    expect(slugify("  Crème Brûlée & Café  ", "restaurant")).toBe(
      "creme-brulee-cafe",
    );
  });

  it("uses the fallback when no slug characters remain", () => {
    expect(slugify("!!!", "menu")).toBe("menu");
  });

  it("truncates the base and suffix to 80 characters", () => {
    const base = "a".repeat(80);
    const candidate = slugWithSuffix(base, 12);
    expect(candidate).toHaveLength(80);
    expect(candidate.endsWith("-12")).toBe(true);
  });
});
