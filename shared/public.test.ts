import { describe, expect, it } from 'vitest';
import {
  PUBLIC_DAILY_CLICK_BUDGET,
  PUBLIC_DAILY_CLICK_LIMIT,
  clicksToday,
  isBudgetReached,
  isLinkCapReached,
  isPublicSlug,
  randomPublicSlug,
} from './public';
import { SLUG_ALPHABET } from './slug';
import { DAY_MS } from './time';

/** 27 Sep 2026, 14:32 WIB. */
const NOW = Date.UTC(2026, 8, 27, 7, 32);
const TODAY = Date.UTC(2026, 8, 27);
const YESTERDAY = TODAY - DAY_MS;

describe('isPublicSlug', () => {
  it('accepts exactly six characters from the generator alphabet', () => {
    expect(isPublicSlug('x7kq2m')).toBe(true);
    expect(isPublicSlug('bn4tzw')).toBe(true);
    expect(isPublicSlug('222222')).toBe(true);
  });

  it('rejects any other length', () => {
    expect(isPublicSlug('x7kq2')).toBe(false);
    expect(isPublicSlug('x7kq2mm')).toBe(false);
    expect(isPublicSlug('')).toBe(false);
  });

  it('rejects the look alike characters left out of the alphabet', () => {
    for (const char of ['l', 'o', '0', '1']) {
      expect(isPublicSlug(`x7kq2${char}`), char).toBe(false);
    }
  });

  it('rejects uppercase, hyphens, and other symbols', () => {
    expect(isPublicSlug('X7KQ2M')).toBe(false);
    expect(isPublicSlug('x7-q2m')).toBe(false);
    expect(isPublicSlug('x7kq2/')).toBe(false);
  });

  it('rejects reserved words that fit the alphabet', () => {
    expect(isPublicSlug('assets')).toBe(false);
    expect(isPublicSlug('static')).toBe(false);
  });
});

describe('randomPublicSlug', () => {
  it('produces slugs the server accepts', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(isPublicSlug(randomPublicSlug())).toBe(true);
    }
  });

  it('maps each byte to the alphabet by its low five bits', () => {
    const fill = (bytes: Uint8Array) => bytes.map((_, i) => i + 32);
    expect(randomPublicSlug(fill)).toBe(SLUG_ALPHABET.slice(0, 6));
  });

  it('draws again when the result is a reserved word', () => {
    const assets = [...'assets'].map((char) => SLUG_ALPHABET.indexOf(char));
    let call = 0;
    const fill = (bytes: Uint8Array) => {
      call += 1;
      return call === 1 ? Uint8Array.from(assets) : bytes.fill(0);
    };
    expect(randomPublicSlug(fill)).toBe('aaaaaa');
    expect(call).toBe(2);
  });
});

describe('clicksToday', () => {
  it('reads the counter when it belongs to the current UTC day', () => {
    expect(clicksToday(TODAY, 41, NOW)).toBe(41);
  });

  it('reads zero for a counter from an earlier day', () => {
    expect(clicksToday(YESTERDAY, 499, NOW)).toBe(0);
    expect(clicksToday(0, 0, NOW)).toBe(0);
  });

  it('rolls over at 00:00 UTC, which is 07:00 WIB', () => {
    const lastMs = TODAY + DAY_MS - 1;
    expect(clicksToday(TODAY, 12, lastMs)).toBe(12);
    expect(clicksToday(TODAY, 12, lastMs + 1)).toBe(0);
  });
});

describe('isLinkCapReached', () => {
  it('blocks from the limit onward, today only', () => {
    expect(isLinkCapReached(TODAY, PUBLIC_DAILY_CLICK_LIMIT - 1, NOW)).toBe(false);
    expect(isLinkCapReached(TODAY, PUBLIC_DAILY_CLICK_LIMIT, NOW)).toBe(true);
    expect(isLinkCapReached(TODAY, PUBLIC_DAILY_CLICK_LIMIT + 20, NOW)).toBe(true);
    expect(isLinkCapReached(YESTERDAY, PUBLIC_DAILY_CLICK_LIMIT, NOW)).toBe(false);
  });
});

describe('isBudgetReached', () => {
  it('treats a missing budget row as zero clicks', () => {
    expect(isBudgetReached(null)).toBe(false);
  });

  it('blocks from the budget onward', () => {
    expect(isBudgetReached(PUBLIC_DAILY_CLICK_BUDGET - 1)).toBe(false);
    expect(isBudgetReached(PUBLIC_DAILY_CLICK_BUDGET)).toBe(true);
  });
});
