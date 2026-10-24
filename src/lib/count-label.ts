export function countLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function itemCountLabel(count: number): string {
  return countLabel(count, "item");
}
