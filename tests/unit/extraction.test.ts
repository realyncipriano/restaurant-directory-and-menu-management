import { afterEach, describe, expect, it, vi } from "vitest";

import { extractMenuItems } from "@/lib/extraction/openai";

const config = {
  provider: "openai" as const,
  baseUrl: "https://provider.example/v1",
  apiKey: "test-key",
  model: "test-model",
  maxPages: 10,
  timeoutMs: 5000,
};

function providerResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("menu extraction", () => {
  it("normalizes prices, variants, modifiers and confidence", async () => {
    const fetchMock = vi.fn(
      async (url: string, init?: RequestInit) => {
        void url;
        void init;
        return providerResponse(
        "```json\n" +
          JSON.stringify({
            items: [
              {
                page: 2,
                category: "Mains",
                name: "  Chicken Adobo ",
                description: "Braised chicken",
                price: "₱185.50",
                variants: [{ name: "Regular", price: "185.50" }],
                modifiers: [{ name: "Extra rice", price: "25", isAvailable: true }],
                availability: "available",
                confidence: 140,
              },
              {
                category: "",
                name: "Unreadable Price",
                price: "not a price",
                availability: "unavailable",
                confidence: 20,
              },
            ],
          }) +
          "\n```",
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractMenuItems(config, [
      { dataUrl: "data:image/png;base64,AAAA" },
    ]);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      pageNumber: 2,
      categoryName: "Mains",
      name: "Chicken Adobo",
      basePriceMinor: 18550,
      confidence: 100,
      availabilityStatus: "available",
    });
    expect(result.items[0]?.variants[0]).toEqual({
      name: "Regular",
      priceMinor: 18550,
    });
    expect(result.items[0]?.modifiers[0]).toEqual({
      name: "Extra rice",
      additionalPriceMinor: 2500,
      isAvailable: true,
    });
    expect(result.items[1]).toMatchObject({
      categoryName: "Uncategorized",
      basePriceMinor: null,
      availabilityStatus: "unavailable",
      confidence: 20,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://provider.example/v1/chat/completions");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
      },
    });
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("test-model");
    expect(JSON.stringify(body.messages)).toContain(
      "data:image/png;base64,AAAA",
    );
  });

  it("keeps every detected category and canonicalizes case-insensitive names", async () => {
    const fetchMock = vi.fn(async () =>
      providerResponse(
        JSON.stringify({
          categories: ["Coffee", "Non-coffee", "Espresso Specials"],
          items: [
            { category: "coffee", name: "Latte", price: "120.00" },
            { category: "NON-COFFEE", name: "Matcha", price: "130.00" },
            {
              category: "Espresso Specials",
              name: "Americano",
              price: "100.00",
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractMenuItems(config, [
      { dataUrl: "data:image/png;base64,AAAA" },
    ]);

    expect(result.items.map((item) => item.categoryName)).toEqual([
      "Coffee",
      "Non-coffee",
      "Espresso Specials",
    ]);
  });

  it("maps generic placeholder categories to Uncategorized", async () => {
    const fetchMock = vi.fn(async () =>
      providerResponse(
        JSON.stringify({
          categories: ["Menu 1"],
          items: [
            { category: "Menu 1", name: "Latte", price: "120.00" },
            { category: "Page 2", name: "Matcha", price: "130.00" },
            { category: "  ", name: "Americano", price: "100.00" },
            { category: "Menu", name: "Mocha", price: "140.00" },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractMenuItems(config, [
      { dataUrl: "data:image/png;base64,AAAA" },
    ]);

    expect(result.items.map((item) => item.categoryName)).toEqual([
      "Uncategorized",
      "Uncategorized",
      "Uncategorized",
      "Uncategorized",
    ]);
  });

  it("instructs the model to detect multiple category sections", async () => {
    const fetchMock = vi.fn(
      async (url: string, init?: RequestInit) => {
        void url;
        void init;
        return providerResponse(
          JSON.stringify({ categories: [], items: [] }),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await extractMenuItems(config, [
      { dataUrl: "data:image/png;base64,AAAA" },
    ]);

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    const userContent = body.messages[1].content;

    expect(userContent[0].text).toContain(
      "A single image often contains several category sections",
    );
    expect(userContent[0].text).toContain('Never use "Menu"');
    expect(userContent[1]).toMatchObject({
      type: "image_url",
      image_url: { detail: "high" },
    });
  });

  it("rejects provider error responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );

    await expect(
      extractMenuItems(config, [{ dataUrl: "data:image/png;base64,AAAA" }]),
    ).rejects.toThrow(/status 401/);
  });

  it("rejects malformed provider content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => providerResponse("not json")),
    );

    await expect(
      extractMenuItems(config, [{ dataUrl: "data:image/png;base64,AAAA" }]),
    ).rejects.toThrow();
  });
});
