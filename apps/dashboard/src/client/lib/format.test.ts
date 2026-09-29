import { describe, expect, it } from 'vitest';
import {
  formatBucketLabel,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
  formatTime,
  fromWibInput,
  spansYears,
  toWibInput,
} from './format';

/** An instant given as WIB wall clock time. */
const wib = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h - 7, min);

describe('formatNumber', () => {
  it('uses dots as thousands separators, per the brief', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1284)).toBe('1.284');
    expect(formatNumber(1234567)).toBe('1.234.567');
  });

  it('rounds to whole numbers', () => {
    expect(formatNumber(1284.6)).toBe('1.285');
  });
});

describe('dates and times in WIB', () => {
  it('formats as the design writes them', () => {
    const moment = wib(2026, 9, 27, 14, 32);
    expect(formatDate(moment)).toBe('27 Sep 2026');
    expect(formatTime(moment)).toBe('14:32');
    expect(formatDateTime(moment)).toBe('27 Sep 2026, 14:32 WIB');
  });

  it('uses the WIB calendar day around midnight, not UTC', () => {
    // 00:30 WIB on 28 Sep is still 27 Sep in UTC.
    expect(formatDate(wib(2026, 9, 28, 0, 30))).toBe('28 Sep 2026');
    expect(formatTime(wib(2026, 9, 28, 0, 30))).toBe('00:30');
  });
});

describe('formatDateRange', () => {
  it('shares month and year when it can', () => {
    expect(formatDateRange(wib(2026, 9, 21), wib(2026, 9, 27, 14))).toBe('21 to 27 Sep 2026');
  });

  it('names both months across a month boundary', () => {
    expect(formatDateRange(wib(2026, 8, 28), wib(2026, 9, 3))).toBe('28 Aug to 3 Sep 2026');
  });

  it('names both years across a year boundary', () => {
    expect(formatDateRange(wib(2025, 12, 29), wib(2026, 1, 4))).toBe('29 Dec 2025 to 4 Jan 2026');
  });
});

describe('formatRelative', () => {
  const now = wib(2026, 9, 27, 14, 32);
  it('matches the LAST CLICK wording', () => {
    expect(formatRelative(now - 20_000, now)).toBe('Just now');
    expect(formatRelative(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(formatRelative(now - 60 * 60_000, now)).toBe('1 hour ago');
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(formatRelative(now - 26 * 3_600_000, now)).toBe('1 day ago');
    expect(formatRelative(now - 4 * 86_400_000, now)).toBe('4 days ago');
  });
});

describe('formatPercent', () => {
  it('rounds and guards against division by zero', () => {
    expect(formatPercent(82, 100)).toBe('82%');
    expect(formatPercent(1, 3)).toBe('33%');
    expect(formatPercent(5, 0)).toBe('0%');
  });
});

describe('datetime-local input in WIB', () => {
  it('writes the WIB wall clock regardless of the machine time zone', () => {
    expect(toWibInput(wib(2026, 12, 31, 23, 59))).toBe('2026-12-31T23:59');
    expect(toWibInput(null)).toBe('');
  });

  it('reads the value back as WIB', () => {
    expect(fromWibInput('2026-12-31T23:59')).toBe(wib(2026, 12, 31, 23, 59));
    expect(fromWibInput('')).toBeNull();
    expect(fromWibInput('not a date')).toBeNull();
  });

  it('round trips', () => {
    const moment = wib(2027, 1, 1, 0, 5);
    expect(fromWibInput(toWibInput(moment))).toBe(moment);
  });
});

describe('bucket labels', () => {
  it('labels hours, days and months', () => {
    expect(formatBucketLabel(wib(2026, 9, 27, 15), 'hour')).toBe('15:00');
    expect(formatBucketLabel(wib(2026, 9, 27), 'day')).toBe('27 Sep');
    expect(formatBucketLabel(wib(2026, 9, 1), 'month')).toBe('Sep');
    expect(formatBucketLabel(wib(2026, 9, 1), 'month', true)).toBe('Sep 2026');
  });

  it('detects a series that crosses a year', () => {
    expect(spansYears([wib(2025, 11, 1), wib(2026, 2, 1)])).toBe(true);
    expect(spansYears([wib(2026, 3, 1), wib(2026, 9, 1)])).toBe(false);
  });
});
