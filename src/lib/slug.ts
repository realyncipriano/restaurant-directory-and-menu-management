const MAX_SLUG_LENGTH = 80;

export function slugify(value: string, fallback: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_SLUG_LENGTH) || fallback
  );
}

export function slugWithSuffix(base: string, suffix: number): string {
  const suffixText = String(suffix);
  return `${base.slice(
    0,
    MAX_SLUG_LENGTH - suffixText.length - 1,
  )}-${suffixText}`;
}
