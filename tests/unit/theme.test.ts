import { describe, expect, it } from "vitest";

import {
  getStoredTheme,
  isTheme,
  parseTheme,
  resolveTheme,
  setStoredTheme,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

describe("theme", () => {
  it("uses a namespaced storage key", () => {
    expect(THEME_STORAGE_KEY).toBe("menu-directory-theme");
  });

  it("recognizes supported themes", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("system")).toBe(true);
    expect(isTheme("sepia")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it("falls back to system for missing or unknown values", () => {
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme("")).toBe("system");
    expect(parseTheme("sepia")).toBe("system");
  });

  it("keeps an explicit preference regardless of the system theme", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("resolves the system theme from the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("keeps a preference in memory when storage is unavailable", () => {
    setStoredTheme("dark");
    expect(getStoredTheme()).toBe("dark");

    setStoredTheme("system");
    expect(getStoredTheme()).toBe("system");
  });
});
