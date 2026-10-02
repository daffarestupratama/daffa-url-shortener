import type { Bucket, Range } from './types';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** WIB is UTC+7 all year, with no daylight saving. */
export const WIB_OFFSET_MS = 7 * HOUR_MS;

export interface RangeWindow {
  range: Range;
  bucket: Bucket;
  /** First bucket start, inclusive. */
  start: number;
  /** The moment the window was computed. */
  end: number;
}

export function hourStart(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

/** The start of the clock hour after the one containing `ms`. */
export function nextHourStart(ms: number): number {
  return hourStart(ms) + HOUR_MS;
}

/**
 * 00:00 UTC of the day containing `ms`. Public link click limits count per UTC
 * day, which begins at 07:00 WIB, the same moment Cloudflare resets its daily
 * free plan quotas.
 */
export function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** 00:00 UTC of the following day, when public daily limits reset. */
export function nextUtcDayStart(ms: number): number {
  return utcDayStart(ms) + DAY_MS;
}

/** Whole seconds from `now` until `target`, rounded up and never below 1. Used for Retry-After. */
export function secondsUntil(target: number, now: number): number {
  return Math.max(1, Math.ceil((target - now) / 1000));
}

/** Midnight WIB of the day containing `ms`, as an epoch value. */
export function wibDayStart(ms: number): number {
  return Math.floor((ms + WIB_OFFSET_MS) / DAY_MS) * DAY_MS - WIB_OFFSET_MS;
}

/** The first of the WIB month containing `ms`, at midnight WIB. */
export function wibMonthStart(ms: number): number {
  const shifted = new Date(ms + WIB_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - WIB_OFFSET_MS;
}

function nextWibMonthStart(monthStart: number): number {
  const shifted = new Date(monthStart + WIB_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1) - WIB_OFFSET_MS;
}

const DAY_COUNTS: Record<'7d' | '30d' | '90d', number> = { '7d': 7, '30d': 30, '90d': 90 };

/**
 * The analytics window for a range. Day ranges count calendar days in WIB and
 * include today, so 7d on 27 Sep covers 21 to 27 Sep, exactly as the design
 * caption reads. 24h is 24 whole hours ending with the current one. `all`
 * starts at the WIB month the link was created in.
 */
export function rangeWindow(range: Range, now: number, createdAt: number): RangeWindow {
  if (range === '24h') {
    return { range, bucket: 'hour', start: hourStart(now) - 23 * HOUR_MS, end: now };
  }
  if (range === 'all') {
    return { range, bucket: 'month', start: wibMonthStart(Math.min(createdAt, now)), end: now };
  }
  const days = DAY_COUNTS[range];
  return { range, bucket: 'day', start: wibDayStart(now) - (days - 1) * DAY_MS, end: now };
}

/**
 * Every bucket start in the window, oldest first. The API fills each one so
 * the chart always receives a dense series: 24, 7, 30 or 90 points, or one per
 * month for `all`.
 */
export function bucketStarts(window: RangeWindow): number[] {
  const starts: number[] = [];
  if (window.bucket === 'month') {
    for (let month = window.start; month <= window.end; month = nextWibMonthStart(month)) {
      starts.push(month);
    }
    return starts;
  }
  const step = window.bucket === 'hour' ? HOUR_MS : DAY_MS;
  for (let start = window.start; start <= window.end; start += step) {
    starts.push(start);
  }
  return starts;
}
