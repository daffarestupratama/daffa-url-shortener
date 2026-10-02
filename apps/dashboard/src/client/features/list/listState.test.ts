import { describe, expect, it } from 'vitest';
import { countsAfterRemove, mergeById, patchById, showingText } from './listState';

const row = (id: number, label = `r${id}`) => ({ id, label });

describe('mergeById', () => {
  it('appends a new page in order', () => {
    expect(mergeById([row(1), row(2)], [row(3), row(4)]).map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('drops rows already shown and keeps the first copy', () => {
    const merged = mergeById([row(1, 'first'), row(2)], [row(1, 'again'), row(3), row(3, 'twice')]);
    expect(merged.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(merged[0]!.label).toBe('first');
  });

  it('handles empty pages on either side', () => {
    expect(mergeById([], [row(1)])).toEqual([row(1)]);
    expect(mergeById([row(1)], [])).toEqual([row(1)]);
  });
});

describe('patchById', () => {
  it('replaces only the matching row', () => {
    const items = [row(1), row(2)];
    const patched = patchById(items, 2, (r) => ({ ...r, label: 'changed' }));
    expect(patched[1]!.label).toBe('changed');
    expect(patched[0]).toBe(items[0]);
  });
});

describe('countsAfterRemove', () => {
  const counts = { private: { matching: 4, total: 9 }, public: { matching: 1, total: 3 } };

  it('decrements the tab of the deleted row only', () => {
    expect(countsAfterRemove(counts, 'public')).toEqual({
      private: { matching: 4, total: 9 },
      public: { matching: 0, total: 2 },
    });
  });

  it('never goes below zero', () => {
    const none = { private: { matching: 0, total: 0 }, public: { matching: 0, total: 0 } };
    expect(countsAfterRemove(none, 'private').private).toEqual({ matching: 0, total: 0 });
  });
});

describe('showingText', () => {
  it('formats both numbers with dots', () => {
    expect(showingText(25, 1234)).toBe('Showing 25 of 1.234');
  });

  it('never shows fewer in total than are loaded', () => {
    expect(showingText(30, 27)).toBe('Showing 30 of 30');
  });
});
