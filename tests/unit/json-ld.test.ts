import { describe, expect, it } from "vitest";

import { serializeJsonLd } from "@/lib/json-ld";

describe("serializeJsonLd", () => {
  it("serializes ordinary structured data as JSON", () => {
    const data = {
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: "Cafe Uno",
      servesCuisine: "Filipino",
    };

    const serialized = serializeJsonLd(data);

    expect(serialized).toBe(JSON.stringify(data));
    expect(JSON.parse(serialized)).toEqual(data);
  });

  it("prevents a script-closing sequence from terminating the script element", () => {
    const data = {
      name: "</script><script>alert(1)</script>",
    };

    const serialized = serializeJsonLd(data);

    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script>");
    expect(JSON.parse(serialized)).toEqual(data);
  });

  it("escapes markup-like values while preserving their meaning", () => {
    const data = {
      description: "<b>Fresh</b> & <i>local</i>",
      html: "<img src=x onerror=alert(1)>",
    };

    const serialized = serializeJsonLd(data);

    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized)).toEqual(data);
  });

  it("preserves nested values, quotes, unicode, and zero values", () => {
    const data = {
      "@context": "https://schema.org",
      "@type": "Menu",
      hasMenuSection: [
        {
          name: "Coffee",
          hasMenuItem: [{ name: "Latte", offers: { price: 0 } }],
        },
      ],
      note: 'Quote " and backslash \\',
      currency: "₱",
    };

    const serialized = serializeJsonLd(data);

    expect(JSON.parse(serialized)).toEqual(data);
    expect(serialized).toBe(JSON.stringify(data));
  });
});
