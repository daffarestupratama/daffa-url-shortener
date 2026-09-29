/**
 * Tag normalization, ported from the design prototype: trimmed, lowercased,
 * a leading hash dropped, and any run of commas or whitespace folded into a
 * single hyphen.
 */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[,\s]+/g, '-');
}

/** Appends a normalized tag, ignoring empties and duplicates. */
export function addTag(tags: readonly string[], raw: string): string[] {
  const tag = normalizeTag(raw);
  if (!tag || tags.includes(tag)) return [...tags];
  return [...tags, tag];
}

/** Normalizes a whole list, dropping empties and duplicates but keeping order. */
export function normalizeTags(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const tag = normalizeTag(item);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}
