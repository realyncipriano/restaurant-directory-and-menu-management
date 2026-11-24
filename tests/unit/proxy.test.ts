import { NextRequest } from "next/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  REQUEST_ID_HEADER,
  isRequestId,
} from "@/lib/observability/request-id";

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

function expectRequestId(response: Response) {
  expect(isRequestId(response.headers.get(REQUEST_ID_HEADER))).toBe(true);
}

function expectNotFound(response: Response) {
  expect(response.status).toBe(404);
  expect(response.headers.get("content-type")).toBe(
    "text/html; charset=utf-8",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-robots-tag")).toBe("noindex");
  expectRequestId(response);
}

function expectServiceUnavailable(response: Response) {
  expect(response.status).toBe(503);
  expect(response.headers.get("content-type")).toBe(
    "text/html; charset=utf-8",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("retry-after")).toBe("30");
  expect(response.headers.get("x-robots-tag")).toBe("noindex");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expectRequestId(response);
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
    expectRequestId(response);
  });

  it("generates a request ID and forwards it downstream", async () => {
    const response = await proxy(request("/restaurants/k-cafe"));
    const requestId = response.headers.get(REQUEST_ID_HEADER);

    expect(isRequestId(requestId)).toBe(true);
    expect(
      response.headers.get("x-middleware-request-x-request-id"),
    ).toBe(requestId);
    expect(
      response.headers.get("x-middleware-override-headers"),
    ).toContain(REQUEST_ID_HEADER);
  });

  it("reuses a valid inbound request ID for correlation", async () => {
    const response = await proxy(
      request("/restaurants/k-cafe", {
        headers: { [REQUEST_ID_HEADER]: "req_upstream-1234" },
      }),
    );

    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(
      "req_upstream-1234",
    );
  });

  it("replaces an invalid inbound request ID", async () => {
    const response = await proxy(
      request("/restaurants/k-cafe", {
        headers: { [REQUEST_ID_HEADER]: "not valid" },
      }),
    );

    expect(response.headers.get(REQUEST_ID_HEADER)).not.toBe("not valid");
    expectRequestId(response);
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

    const restaurantBody = await restaurant.text();
    const menuBody = await menu.text();
    expect(restaurantBody).not.toContain("Bad_Slug");
    expect(menuBody).not.toContain("Bad_Slug");
    expect(restaurantBody).not.toContain("DATABASE_URL");
    expect(menuBody).not.toContain("DATABASE_URL");
    expect(restaurantBody).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(menuBody).not.toMatch(/postgres(?:ql)?:\/\//i);
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

  it("checks direct menu document requests", async () => {
    existenceMocks.publicMenuExists.mockResolvedValue(false);

    const response = await proxy(
      request("/restaurants/k-cafe/menus/unknown-menu", {
        headers: { "sec-fetch-dest": "document" },
      }),
    );

    expectNotFound(response);
    expect(existenceMocks.publicMenuExists).toHaveBeenCalledWith(
      {},
      "k-cafe",
      "unknown-menu",
    );
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

  it("continues HEAD requests for known resources", async () => {
    const restaurant = await proxy(
      request("/restaurants/k-cafe", { method: "HEAD" }),
    );
    const menu = await proxy(
      request("/restaurants/k-cafe/menus/lunch", { method: "HEAD" }),
    );

    expect(restaurant.status).toBe(200);
    expect(restaurant.headers.get("x-middleware-next")).toBe("1");
    expect(menu.status).toBe(200);
    expect(menu.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not reflect the requested slug into the not-found HTML", async () => {
    existenceMocks.publicRestaurantExists.mockResolvedValue(false);

    const response = await proxy(
      request("/restaurants/secret-slug-value"),
    );

    expect(await response.text()).not.toContain("secret-slug-value");
  });

  it("returns 503 when the database handle cannot be created", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    getDbMock.mockImplementation(() => {
      throw new Error(
        "DATABASE_URL=postgres://user:password@example/secret",
      );
    });

    const restaurant = await proxy(request("/restaurants/k-cafe"));
    const menu = await proxy(request("/restaurants/k-cafe/menus/lunch"));

    expectServiceUnavailable(restaurant);
    expectServiceUnavailable(menu);
    expect(restaurant.headers.get("x-middleware-next")).toBeNull();
    expect(menu.headers.get("x-middleware-next")).toBeNull();
    expect(existenceMocks.publicRestaurantExists).not.toHaveBeenCalled();
    expect(existenceMocks.publicMenuExists).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(2);
    const logged = errorLog.mock.calls
      .map(([message]) => String(message))
      .join("\n");
    expect(logged).not.toContain("k-cafe");
    expect(logged).not.toContain("postgres://");
    expect(logged).not.toContain("DATABASE_URL");
  });

  it("returns 503 when the restaurant existence query fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    existenceMocks.publicRestaurantExists.mockRejectedValue(
      new Error(
        "connection failed for secret-restaurant; DATABASE_URL=postgres://user:password@example/secret",
      ),
    );

    const response = await proxy(
      request("/restaurants/secret-restaurant"),
    );

    expectServiceUnavailable(response);
    expect(response.headers.get("x-middleware-next")).toBeNull();

    const body = await response.text();
    expect(body).not.toContain("secret-restaurant");
    expect(body).not.toContain("postgres://");
    expect(body).not.toContain("DATABASE_URL");
    expect(body).not.toContain("connection failed");

    expect(errorLog).toHaveBeenCalledTimes(1);
    const logged = String(errorLog.mock.calls[0]?.[0]);
    expect(logged).not.toContain("secret-restaurant");
    expect(logged).not.toContain("postgres://");
    expect(logged).not.toContain("DATABASE_URL");
  });

  it("returns 503 when the menu existence query fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    existenceMocks.publicMenuExists.mockRejectedValue(
      new Error("query failed for secret-menu"),
    );

    const response = await proxy(
      request("/restaurants/k-cafe/menus/secret-menu"),
    );

    expectServiceUnavailable(response);
    expect(response.headers.get("x-middleware-next")).toBeNull();

    const body = await response.text();
    expect(body).not.toContain("secret-menu");
    expect(body).not.toContain("query failed");

    expect(errorLog).toHaveBeenCalledTimes(1);
    const logged = String(errorLog.mock.calls[0]?.[0]);
    expect(logged).not.toContain("secret-menu");
    expect(logged).not.toContain("query failed");
  });

  it("returns an empty 503 body for HEAD requests during an outage", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    existenceMocks.publicRestaurantExists.mockRejectedValue(
      new Error("database unavailable"),
    );
    existenceMocks.publicMenuExists.mockRejectedValue(
      new Error("database unavailable"),
    );

    const restaurant = await proxy(
      request("/restaurants/k-cafe", { method: "HEAD" }),
    );
    const menu = await proxy(
      request("/restaurants/k-cafe/menus/lunch", { method: "HEAD" }),
    );

    expectServiceUnavailable(restaurant);
    expectServiceUnavailable(menu);
    expect(restaurant.body).toBeNull();
    expect(menu.body).toBeNull();
    expect(errorLog).toHaveBeenCalledTimes(2);
  });

  it("returns an empty 503 body for HEAD when the database handle fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    getDbMock.mockImplementation(() => {
      throw new Error(
        "DATABASE_URL=postgres://user:password@example/secret; connection refused for k-cafe",
      );
    });

    const response = await proxy(
      request("/restaurants/k-cafe", { method: "HEAD" }),
    );

    expectServiceUnavailable(response);
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(response.body).toBeNull();
    expect(existenceMocks.publicRestaurantExists).not.toHaveBeenCalled();
    expect(existenceMocks.publicMenuExists).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(1);

    const logged = String(errorLog.mock.calls[0]?.[0]);
    expect(logged).not.toContain("k-cafe");
    expect(logged).not.toContain("connection refused");
    expect(logged).not.toContain("postgres://");
    expect(logged).not.toContain("DATABASE_URL");
    expect(logged).not.toContain("password");
    expect(logged).not.toContain("secret");
  });

  it("rejects invalid slugs before querying an unavailable database", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    getDbMock.mockImplementation(() => {
      throw new Error(
        "DATABASE_URL=postgres://user:password@example/secret",
      );
    });

    const restaurant = await proxy(request("/restaurants/Bad_Slug"));
    const menu = await proxy(
      request("/restaurants/k-cafe/menus/Bad_Slug"),
    );

    expectNotFound(restaurant);
    expectNotFound(menu);
    expect(existenceMocks.publicRestaurantExists).not.toHaveBeenCalled();
    expect(existenceMocks.publicMenuExists).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("keeps /login accessible without touching the database", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    getDbMock.mockImplementation(() => {
      throw new Error(
        "DATABASE_URL=postgres://user:password@example/secret",
      );
    });

    const response = await proxy(request("/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(existenceMocks.publicRestaurantExists).not.toHaveBeenCalled();
    expect(existenceMocks.publicMenuExists).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
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

  it("does not intercept empty search or cuisine result pages", async () => {
    const search = await proxy(request("/?q=no-such-restaurant"));
    const cuisine = await proxy(
      request("/?cuisine=NoSuchCuisine"),
    );

    expect(search.status).toBe(200);
    expect(search.headers.get("x-middleware-next")).toBe("1");
    expect(search.headers.get("location")).toBeNull();
    expect(cuisine.status).toBe(200);
    expect(cuisine.headers.get("x-middleware-next")).toBe("1");
    expect(cuisine.headers.get("location")).toBeNull();
    expect(existenceMocks.publicRestaurantExists).not.toHaveBeenCalled();
    expect(existenceMocks.publicMenuExists).not.toHaveBeenCalled();
  });
});

describe("dashboard proxy guard", () => {
  it("still redirects unauthenticated dashboard requests", async () => {
    getDbMock.mockImplementation(() => {
      throw new Error("DATABASE_URL=postgres://user:password@example/secret");
    });

    const response = await proxy(
      request("/dashboard/restaurants?page=2"),
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(
      "/dashboard/restaurants",
    );
    expect(getDbMock).not.toHaveBeenCalled();
    expectRequestId(response);
  });

  it("still allows dashboard requests with a session cookie", async () => {
    const response = await proxy(
      request("/dashboard/restaurants", {
        headers: { cookie: "rdmm_session=test-token" },
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expectRequestId(response);
  });

  it("does not treat a request ID as authentication", async () => {
    const response = await proxy(
      request("/dashboard/restaurants", {
        headers: { [REQUEST_ID_HEADER]: "req_upstream-1234" },
      }),
    );

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/login",
    );
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(
      "req_upstream-1234",
    );
  });
});
