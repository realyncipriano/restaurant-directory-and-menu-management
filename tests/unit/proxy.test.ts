import { NextRequest } from "next/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const existenceMocks = vi.hoisted(() => ({
  publicRestaurantExists: vi.fn(),
  publicMenuExists: vi.fn(),
}));

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({
  getDb: getDbMock,
}));

vi.mock("@/server/services/public-existence", () => existenceMocks);

import { proxy } from "@/proxy";

function request(
  path: string,
  init: ConstructorParameters<typeof NextRequest>[1] = {},
): NextRequest {
  return new NextRequest(`http://localhost${path}`, init);
}

function expectNotFound(response: Response) {
  expect(response.status).toBe(404);
  expect(response.headers.get("content-type")).toBe(
    "text/html; charset=utf-8",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-robots-tag")).toBe("noindex");
}

beforeEach(() => {
  getDbMock.mockReturnValue({});
  existenceMocks.publicRestaurantExists.mockReset();
  existenceMocks.publicMenuExists.mockReset();
  existenceMocks.publicRestaurantExists.mockResolvedValue(true);
  existenceMocks.publicMenuExists.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("public detail proxy", () => {
  it("returns a direct 404 for an unknown restaurant", async () => {
    existenceMocks.publicRestaurantExists.mockResolvedValue(false);

    const response = await proxy(request("/restaurants/unknown-kitchen"));

    expectNotFound(response);
    expect(existenceMocks.publicRestaurantExists).toHaveBeenCalledWith(
      {},
      "unknown-kitchen",
    );
  });

  it("returns a direct 404 for an unknown menu", async () => {
    existenceMocks.publicMenuExists.mockResolvedValue(false);

    const response = await proxy(
      request("/restaurants/k-cafe/menus/unknown-menu"),
    );

    expectNotFound(response);
    expect(existenceMocks.publicMenuExists).toHaveBeenCalledWith(
      {},
      "k-cafe",
      "unknown-menu",
    );
  });

  it("continues to render a known active restaurant", async () => {
    const response = await proxy(request("/restaurants/k-cafe"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("continues to render a known published menu", async () => {
    const response = await proxy(
      request("/restaurants/k-cafe/menus/lunch"),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("returns 404 for an inactive restaurant or draft menu", async () => {
    existenceMocks.publicRestaurantExists.mockResolvedValue(false);
    existenceMocks.publicMenuExists.mockResolvedValue(false);

    expectNotFound(await proxy(request("/restaurants/archived-kitchen")));
    expectNotFound(
      await proxy(request("/restaurants/k-cafe/menus/draft-menu")),
    );
  });

  it("rejects invalid slugs before querying the database", async () => {
    const restaurant = await proxy(request("/restaurants/Bad_Slug"));
    const menu = await proxy(
      request("/restaurants/k-cafe/menus/Bad_Slug"),
    );

    expectNotFound(restaurant);
    expectNotFound(menu);
    expect(existenceMocks.publicRestaurantExists).not.toHaveBeenCalled();
    expect(existenceMocks.publicMenuExists).not.toHaveBeenCalled();
  });

  it("checks direct browser document requests", async () => {
    existenceMocks.publicRestaurantExists.mockResolvedValue(false);

    const response = await proxy(
      request("/restaurants/unknown-kitchen", {
        headers: { "sec-fetch-dest": "document" },
      }),
    );

    expectNotFound(response);
    expect(existenceMocks.publicRestaurantExists).toHaveBeenCalled();
  });

  it("returns an empty 404 body for HEAD requests", async () => {
    existenceMocks.publicRestaurantExists.mockResolvedValue(false);
    existenceMocks.publicMenuExists.mockResolvedValue(false);

    const restaurant = await proxy(
      request("/restaurants/unknown-kitchen", { method: "HEAD" }),
    );
    const menu = await proxy(
      request("/restaurants/k-cafe/menus/unknown-menu", {
        method: "HEAD",
      }),
    );

    expectNotFound(restaurant);
    expectNotFound(menu);
    expect(restaurant.body).toBeNull();
    expect(menu.body).toBeNull();
  });

  it("does not reflect the requested slug into the not-found HTML", async () => {
    existenceMocks.publicRestaurantExists.mockResolvedValue(false);

    const response = await proxy(
      request("/restaurants/secret-slug-value"),
    );

    expect(await response.text()).not.toContain("secret-slug-value");
  });

  it("fails open when the database handle cannot be created", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    getDbMock.mockImplementation(() => {
      throw new Error(
        "DATABASE_URL=postgres://user:password@example/secret",
      );
    });

    const response = await proxy(request("/restaurants/k-cafe"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain("k-cafe");
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain("postgres://");
  });

  it("fails open when the existence query fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    existenceMocks.publicMenuExists.mockRejectedValue(
      new Error("query failed for secret-slug"),
    );

    const response = await proxy(
      request("/restaurants/k-cafe/menus/secret-slug"),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain(
      "secret-slug",
    );
  });

  it("skips checks for non-document and non-GET/HEAD requests", async () => {
    const nonDocument = await proxy(
      request("/restaurants/k-cafe", {
        headers: { "sec-fetch-dest": "empty" },
      }),
    );
    const post = await proxy(
      request("/restaurants/k-cafe", { method: "POST" }),
    );

    expect(nonDocument.headers.get("x-middleware-next")).toBe("1");
    expect(post.headers.get("x-middleware-next")).toBe("1");
    expect(existenceMocks.publicRestaurantExists).not.toHaveBeenCalled();
  });

  it("does not redirect public routes to login", async () => {
    const response = await proxy(request("/restaurants/k-cafe"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("dashboard proxy guard", () => {
  it("still redirects unauthenticated dashboard requests", async () => {
    const response = await proxy(
      request("/dashboard/restaurants?page=2"),
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(
      "/dashboard/restaurants",
    );
  });

  it("still allows dashboard requests with a session cookie", async () => {
    const response = await proxy(
      request("/dashboard/restaurants", {
        headers: { cookie: "rdmm_session=test-token" },
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
