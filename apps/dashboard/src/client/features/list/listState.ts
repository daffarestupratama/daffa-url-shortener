import type { Visibility, VisibilityCount } from '@daffa/shared';
import { formatNumber } from '../../lib/format';

/**
 * Pure helpers behind the infinite list. Pages arrive by cursor, and a live
 * click sort on the Public tab can hand back a row that was already shown,
 * so pages are merged by id instead of concatenated.
 */

/** Appends `incoming` to `existing`, skipping ids already present. Order is kept, the first copy wins. */
export function mergeById<T extends { id: number }>(existing: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set(existing.map((item) => item.id));
  const merged = [...existing];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

/** Replaces the item with `id` by `update(item)`. Other items stay the same objects. */
export function patchById<T extends { id: number }>(items: readonly T[], id: number, update: (item: T) => T): T[] {
  return items.map((item) => (item.id === id ? update(item) : item));
}

/** The counts after one row of `visibility` was deleted. Never below zero. */
export function countsAfterRemove(
  counts: Record<Visibility, VisibilityCount>,
  visibility: Visibility,
): Record<Visibility, VisibilityCount> {
  const current = counts[visibility];
  return {
    ...counts,
    [visibility]: { matching: Math.max(0, current.matching - 1), total: Math.max(0, current.total - 1) },
  };
}

/** "Showing 25 of 137" under the rows while more pages follow. */
export function showingText(loaded: number, matching: number): string {
  return `Showing ${formatNumber(loaded)} of ${formatNumber(Math.max(loaded, matching))}`;
}
