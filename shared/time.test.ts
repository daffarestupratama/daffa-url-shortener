import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  HOUR_MS,
  bucketStarts,
  hourStart,
  nextHourStart,
  nextUtcDayStart,
  rangeWindow,
  secondsUntil,
  utcDayStart,
  wibDayStart,
  wibMonthStart,
} from './time';

/** 27 Sep 2026, 14:32 WIB, the moment the design mockups were drawn at. */
const NOW = Date.UTC(2026, 8, 27, 7, 32);
/** Midnight WIB on a given calendar date, as UTC epoch. */
const wibMidnight = (year: number, month: number, day: number) =>
  Date.UTC(year, month, day) - 7 * HOUR_MS;

describe('wibDayStart', () => {
  it('returns midnight WIB of the same calendar day', () => {
    expect(wibDayStart(NOW)).toBe(wibMidnight(2026, 8, 27));
  });

  it('switches days at midnight WIB, not at midnight UTC', () => {
    const lastMinuteOf26 = wibMidnight(2026, 8, 27) - 60_000;
    expect(wibDayStart(lastMinuteOf26)).toBe(wibMidnight(2026, 8, 26));
    expect(wibDayStart(wibMidnight(2026, 8, 27))).toBe(wibMidnight(2026, 8, 27));
  });
});

describe('wibMonthStart', () => {
  it('returns the first of the WIB month', () => {
    expect(wibMonthStart(NOW)).toBe(wibMidnight(2026, 8, 1));
  });

  it('puts 01:00 WIB on 1 Jan in January even though UTC is still in December', () => {
    const newYearWib = Date.UTC(2025, 11, 31, 18, 0);
    expect(wibMonthStart(newYearWib)).toBe(wibMidnight(2026, 0, 1));
  });
});

describe('rangeWindow and bucketStarts', () => {
  it('24h covers 24 whole hours ending with the current one', () => {
    const window = rangeWindow('24h', NOW, 0);
    const starts = bucketStarts(window);
    expect(window.bucket).toBe('hour');
    expect(starts).toHaveLength(24);
    expect(starts.at(-1)).toBe(hourStart(NOW));
    expect(starts[0]).toBe(hourStart(NOW) - 23 * HOUR_MS);
  });

  it('7d on 27 Sep covers 21 to 27 Sep, matching the design caption', () => {
    const window = rangeWindow('7d', NOW, 0);
    const starts = bucketStarts(window);
    expect(window.bucket).toBe('day');
    expect(starts).toHaveLength(7);
    expect(starts[0]).toBe(wibMidnight(2026, 8, 21));
    expect(starts.at(-1)).toBe(wibMidnight(2026, 8, 27));
  });

  it('30d and 90d produce one bucket per WIB day', () => {
    expect(bucketStarts(rangeWindow('30d', NOW, 0))).toHaveLength(30);
    const ninety = bucketStarts(rangeWindow('90d', NOW, 0));
    expect(ninety).toHaveLength(90);
    for (let i = 1; i < ninety.length; i += 1) {
      expect(ninety[i]! - ninety[i - 1]!).toBe(DAY_MS);
    }
  });

  it('all starts at the WIB month of creation and ends with the current month', () => {
    const created = Date.UTC(2026, 2, 12, 2, 14); // 12 Mar 2026, 09:14 WIB
    const starts = bucketStarts(rangeWindow('all', NOW, created));
    expect(starts).toHaveLength(7); // Mar, Apr, May, Jun, Jul, Aug, Sep
    expect(starts[0]).toBe(wibMidnight(2026, 2, 1));
    expect(starts.at(-1)).toBe(wibMidnight(2026, 8, 1));
  });

  it('month buckets cross a year boundary cleanly', () => {
    const created = wibMidnight(2025, 10, 15);
    const now = wibMidnight(2026, 1, 10);
    expect(bucketStarts(rangeWindow('all', now, created))).toEqual([
      wibMidnight(2025, 10, 1),
      wibMidnight(2025, 11, 1),
      wibMidnight(2026, 0, 1),
      wibMidnight(2026, 1, 1),
    ]);
  });

  it('a link created this month has exactly one monthly bucket', () => {
    expect(bucketStarts(rangeWindow('all', NOW, NOW - HOUR_MS))).toEqual([wibMidnight(2026, 8, 1)]);
  });
});

describe('agreement with the SQL bucket expressions', () => {
  // The API groups clicks in SQL, then places each group on these JS buckets.
  // Both must compute the same start or a group would be dropped. These are the
  // exact expressions from apps/dashboard/src/worker/queries.ts, written in JS.
  const sqlHour = (ts: number) => Math.trunc(ts / 3_600_000) * 3_600_000;
  const sqlDay = (ts: number) =>
    Math.trunc((ts + 25_200_000) / 86_400_000) * 86_400_000 - 25_200_000;

  it('matches for timestamps across a whole year, including WIB midnight edges', () => {
    const start = Date.UTC(2025, 11, 31, 16, 59, 59);
    for (let ts = start; ts < start + 366 * DAY_MS; ts += 7 * HOUR_MS + 13 * 60_000 + 7_000) {
      expect(sqlHour(ts)).toBe(hourStart(ts));
      expect(sqlDay(ts)).toBe(wibDayStart(ts));
    }
  });
});

describe('utcDayStart and nextUtcDayStart', () => {
  it('returns 00:00 UTC of the same day, which is 07:00 WIB', () => {
    expect(utcDayStart(NOW)).toBe(Date.UTC(2026, 8, 27));
    expect(nextUtcDayStart(NOW)).toBe(Date.UTC(2026, 8, 28));
  });

  it('switches days at midnight UTC, not at midnight WIB', () => {
    const midnight = Date.UTC(2026, 8, 28);
    expect(utcDayStart(midnight - 1)).toBe(Date.UTC(2026, 8, 27));
    expect(utcDayStart(midnight)).toBe(midnight);
    // 06:59 WIB on 28 Sep still belongs to the UTC day of 27 Sep.
    expect(utcDayStart(wibMidnight(2026, 8, 28) + 6 * HOUR_MS + 59 * 60_000)).toBe(
      Date.UTC(2026, 8, 27),
    );
  });
});

describe('nextHourStart', () => {
  it('returns the start of the following clock hour', () => {
    expect(nextHourStart(NOW)).toBe(Date.UTC(2026, 8, 27, 8));
    expect(nextHourStart(Date.UTC(2026, 8, 27, 8))).toBe(Date.UTC(2026, 8, 27, 9));
  });
});

describe('secondsUntil', () => {
  it('rounds up to whole seconds', () => {
    expect(secondsUntil(NOW + 1500, NOW)).toBe(2);
    expect(secondsUntil(NOW + DAY_MS, NOW)).toBe(86_400);
  });

  it('never returns less than one second', () => {
    expect(secondsUntil(NOW, NOW)).toBe(1);
    expect(secondsUntil(NOW - 5000, NOW)).toBe(1);
  });
});
