import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

import { config } from "@/proxy";

function matches(
  url: string,
  headers: Record<string, string> = {},
): boolean {
  return unstable_doesMiddlewareMatch({ config, url, headers });
}

const PREFETCH_HEADERS: Array<Record<string, string>> = [
  { rsc: "1" },
  { "next-router-prefetch": "1" },
  { "next-router-segment-prefetch": "segment" },
  { purpose: "prefetch" },
  { "sec-purpose": "prefetch;prerender" },
];

describe("proxy matcher", () => {
  it("keeps matching dashboard routes, including RSC requests", () => {
    expect(matches("/dashboard")).toBe(true);
    expect(matches("/dashboard/restaurants")).toBe(true);
    expect(matches("/dashboard/restaurants", { rsc: "1" })).toBe(true);
  });

  it("matches direct restaurant document requests", () => {
    expect(matches("/restaurants/k-cafe")).toBe(true);
  });

  it("matches direct menu document requests", () => {
    expect(matches("/restaurants/k-cafe/menus/lunch")).toBe(true);
  });

  it.each(PREFETCH_HEADERS)(
    "does not match restaurant requests with %o",
    (headers) => {
      expect(matches("/restaurants/k-cafe", headers)).toBe(false);
    },
  );

  it.each(PREFETCH_HEADERS)(
    "does not match menu requests with %o",
    (headers) => {
      expect(matches("/restaurants/k-cafe/menus/lunch", headers)).toBe(false);
    },
  );

  it("does not match unrelated or non-document paths", () => {
    expect(matches("/")).toBe(false);
    expect(matches("/restaurants")).toBe(false);
    expect(matches("/restaurants/k-cafe/menus/lunch/extra")).toBe(false);
    expect(matches("/api/restaurants/k-cafe")).toBe(false);
    expect(matches("/_next/static/chunk.js")).toBe(false);
    expect(matches("/restaurants-other")).toBe(false);
  });
});
