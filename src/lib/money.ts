export const MAX_PRICE_MINOR = 999_999_999;

export type PriceParseResult =
  | { ok: true; minor: number | null }
  | { ok: false; message: string };

export function parsePriceToMinor(
  value: string | null | undefined,
): PriceParseResult {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return { ok: true, minor: null };
  }

  const cleaned = trimmed
    .replace(/[₱,\s]/g, "")
    .replace(/^php/i, "")
    .replace(/^p(?=\d)/i, "");

  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(cleaned)) {
    return {
      ok: false,
      message: "Enter a price like 99 or 99.50 (up to two decimal places).",
    };
  }

  const [whole, fraction = ""] = cleaned.split(".");
  const minor = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));

  if (!Number.isSafeInteger(minor) || minor > MAX_PRICE_MINOR) {
    return { ok: false, message: "That price is too large." };
  }

  return { ok: true, minor };
}

export function formatMinorForInput(
  minor: number | null | undefined,
): string {
  if (minor === null || minor === undefined) return "";
  return (minor / 100).toFixed(2);
}

export function formatPrice(
  minor: number | null | undefined,
  currency = "PHP",
): string {
  if (minor === null || minor === undefined) {
    return "Price not listed";
  }

  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}
