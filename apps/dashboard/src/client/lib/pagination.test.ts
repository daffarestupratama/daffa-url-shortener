import { describe, expect, it } from 'vitest';
import { pageRange, pageWindow, type PageItem } from './pagination';

/** Renders the items the way the eye reads them: "1 … 7 8 9 … 19". */
const show = (items: PageItem[]) => items.map((item) => (item.kind === 'gap' ? '…' : String(item.page))).join(' ');

describe('pageWindow', () => {
  it('hides itself below two pages', () => {
    expect(pageWindow(1, 0)).toEqual([]);
    expect(pageWindow(1, 1)).toEqual([]);
  });

  it('shows every page when there are few', () => {
    expect(show(pageWindow(1, 2))).toBe('1 2');
    expect(show(pageWindow(2, 5))).toBe('1 2 3 4 5');
  });

  it('keeps a small window around the current page in the middle', () => {
    expect(show(pageWindow(8, 19))).toBe('1 … 7 8 9 … 19');
  });

  it('compacts at the start and at the end', () => {
    expect(show(pageWindow(1, 19))).toBe('1 2 … 19');
    expect(show(pageWindow(19, 19))).toBe('1 … 18 19');
  });

  it('shows a lone skipped page instead of an ellipsis', () => {
    expect(show(pageWindow(4, 19))).toBe('1 2 3 4 5 … 19');
  });

  it('clamps an out of range page', () => {
    expect(show(pageWindow(99, 19))).toBe('1 … 18 19');
  });
});

describe('pageRange', () => {
  it('describes the rows on a page', () => {
    expect(pageRange(1, 10, 185)).toEqual({ from: 1, to: 10 });
    expect(pageRange(8, 10, 185)).toEqual({ from: 71, to: 80 });
    expect(pageRange(19, 10, 185)).toEqual({ from: 181, to: 185 });
    expect(pageRange(1, 10, 0)).toEqual({ from: 0, to: 0 });
  });
});
