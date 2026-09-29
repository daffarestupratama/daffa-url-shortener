export type PageItem = { kind: 'page'; page: number } | { kind: 'gap'; key: string };

/**
 * Page numbers for the compact pagination: the first and last page, a window
 * of `radius` pages either side of the current one, and a gap marker wherever
 * pages are skipped. A gap that would hide a single page shows that page
 * instead, since it takes the same space. Pages are 1 based.
 *
 *   pageWindow(8, 19)  ->  1 ... 7 8 9 ... 19
 */
export function pageWindow(current: number, total: number, radius = 1): PageItem[] {
  if (total <= 1) return [];
  const page = Math.min(Math.max(1, current), total);

  const pages = new Set<number>([1, total]);
  for (let p = page - radius; p <= page + radius; p += 1) {
    if (p >= 1 && p <= total) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);

  const items: PageItem[] = [];
  sorted.forEach((p, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined) {
      if (p - previous === 2) items.push({ kind: 'page', page: p - 1 });
      else if (p - previous > 2) items.push({ kind: 'gap', key: `gap-${previous}` });
    }
    items.push({ kind: 'page', page: p });
  });
  return items;
}

/** "Showing 71 to 80 of 185 recent clicks" parts, for a 1 based page. */
export function pageRange(page: number, pageSize: number, total: number): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from, to: Math.min(total, page * pageSize) };
}
