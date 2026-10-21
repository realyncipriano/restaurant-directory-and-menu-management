import "server-only";

import { z } from "zod";

import type { ExtractionConfig } from "@/lib/env";
import { parsePriceToMinor, MAX_PRICE_MINOR } from "@/lib/money";

const rawVariantSchema = z.object({
  name: z.string(),
  price: z.union([z.string(), z.number()]).nullable().optional(),
});

const rawModifierSchema = z.object({
  name: z.string(),
  price: z.union([z.string(), z.number()]).nullable().optional(),
  isAvailable: z.boolean().optional(),
});

const rawItemSchema = z.object({
  page: z.number().optional(),
  category: z.string().optional(),
  categoryName: z.string().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  price: z.union([z.string(), z.number()]).nullable().optional(),
  variants: z.array(rawVariantSchema).optional(),
  modifiers: z.array(rawModifierSchema).optional(),
  availability: z.string().optional(),
  confidence: z.number().optional(),
});

const responseSchema = z.object({
  items: z.array(rawItemSchema),
});

export type ExtractedVariant = {
  name: string;
  priceMinor: number | null;
};

export type ExtractedModifier = {
  name: string;
  additionalPriceMinor: number | null;
  isAvailable: boolean;
};

export type ExtractedMenuItem = {
  pageNumber: number | null;
  categoryName: string;
  name: string;
  description: string | null;
  basePriceMinor: number | null;
  variants: ExtractedVariant[];
  modifiers: ExtractedModifier[];
  availabilityStatus: "available" | "unavailable";
  confidence: number;
};

export type ExtractionResult = {
  items: ExtractedMenuItem[];
  raw: unknown;
};

const PROMPT = `Extract every menu item visible in these menu page images.

Return a JSON object with an "items" array. Each item must use this shape:
{
  "page": 1,
  "category": "Category heading",
  "name": "Item name",
  "description": null,
  "price": "185.00",
  "variants": [{"name": "Regular", "price": "185.00"}],
  "modifiers": [{"name": "Extra rice", "price": "25.00", "isAvailable": true}],
  "availability": "available",
  "confidence": 0
}

Rules:
- Prices are in Philippine pesos as decimal strings (for example "185.00").
- Use null when a price is not readable. Never invent prices.
- Use the visible category heading. If there is none, use "Menu".
- Put size or serving options in variants, each with its own price.
- Put optional extras in modifiers. Their price is the additional amount.
- Set availability to "unavailable" only when the menu marks it unavailable.
- confidence is 0-100 for how confident you are in the item's name, category, and price.
- Do not omit an item because it is hard to read; include it with low confidence.
- Only return menu items. Do not include restaurant names, addresses, or page numbers as items.`;

function parseNumberPrice(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    const minor = Math.round(value * 100);
    return minor <= MAX_PRICE_MINOR ? minor : null;
  }
  const parsed = parsePriceToMinor(value);
  return parsed.ok ? parsed.minor : null;
}

function extractContent(payload: unknown): string {
  const choice = (payload as {
    choices?: { message?: { content?: unknown } }[];
  })?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  }
  throw new Error("The extraction provider returned no content.");
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const withoutFences = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(withoutFences);
}

export async function extractMenuItems(
  config: ExtractionConfig,
  images: { dataUrl: string }[],
): Promise<ExtractionResult> {
  if (images.length === 0) {
    throw new Error("At least one menu page image is required.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You extract structured menu data from images. Return only valid JSON.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              ...images.map((image) => ({
                type: "image_url",
                image_url: { url: image.dataUrl },
              })),
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `The extraction provider rejected the request (status ${response.status}).`,
      );
    }

    const payload: unknown = await response.json();
    const parsed = responseSchema.parse(
      parseJsonContent(extractContent(payload)),
    );

    const items: ExtractedMenuItem[] = [];
    for (const raw of parsed.items) {
      const name = raw.name.trim();
      if (!name) continue;
      const categoryName =
        (raw.category ?? raw.categoryName ?? "Menu").trim() || "Menu";

      items.push({
        pageNumber:
          typeof raw.page === "number" && Number.isFinite(raw.page)
            ? Math.max(1, Math.floor(raw.page))
            : null,
        categoryName: categoryName.slice(0, 120),
        name: name.slice(0, 160),
        description: raw.description?.trim() || null,
        basePriceMinor: parseNumberPrice(raw.price),
        variants: (raw.variants ?? [])
          .map((variant) => ({
            name: variant.name.trim(),
            priceMinor: parseNumberPrice(variant.price),
          }))
          .filter((variant) => Boolean(variant.name))
          .slice(0, 20),
        modifiers: (raw.modifiers ?? [])
          .map((modifier) => ({
            name: modifier.name.trim(),
            additionalPriceMinor: parseNumberPrice(modifier.price) ?? 0,
            isAvailable: modifier.isAvailable ?? true,
          }))
          .filter((modifier) => Boolean(modifier.name))
          .slice(0, 20),
        availabilityStatus:
          raw.availability?.trim().toLowerCase() === "unavailable"
            ? "unavailable"
            : "available",
        confidence:
          typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
            ? Math.min(100, Math.max(0, Math.round(raw.confidence)))
            : 50,
      });
    }

    return { items, raw: parsed };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The extraction provider timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
