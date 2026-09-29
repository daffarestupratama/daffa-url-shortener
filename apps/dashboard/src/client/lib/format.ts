import { WIB_OFFSET_MS, type Bucket } from '@daffa/shared';

/**
 * Everything shown to the user is in WIB, whatever time zone the browser runs
 * in. Dates use English month names to match the English UI, and numbers use
 * dots as thousands separators, per the design brief: 1.234.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

const pad = (n: number) => String(n).padStart(2, '0');

interface WibParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wibParts(ms: number): WibParts {
  const shifted = new Date(ms + WIB_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** 1284 becomes "1.284". */
export function formatNumber(value: number): string {
  return numberFormat.format(Math.round(value));
}

/** "27 Sep 2026" */
export function formatDate(ms: number): string {
  const p = wibParts(ms);
  return `${p.day} ${MONTHS[p.month]} ${p.year}`;
}

/** "14:20" */
export function formatTime(ms: number): string {
  const p = wibParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "27 Sep 2026, 14:32 WIB" */
export function formatDateTime(ms: number): string {
  return `${formatDate(ms)}, ${formatTime(ms)} WIB`;
}

/**
 * The caption under the 7 day KPIs, written as compactly as the dates allow:
 * "21 to 27 Sep 2026", "28 Aug to 3 Sep 2026", "29 Dec 2025 to 4 Jan 2026".
 */
export function formatDateRange(start: number, end: number): string {
  const a = wibParts(start);
  const b = wibParts(end);
  if (a.year !== b.year) return `${formatDate(start)} to ${formatDate(end)}`;
  if (a.month !== b.month) return `${a.day} ${MONTHS[a.month]} to ${b.day} ${MONTHS[b.month]} ${b.year}`;
  return `${a.day} to ${b.day} ${MONTHS[b.month]} ${b.year}`;
}

/** "Just now", "12 min ago", "1 hour ago", "3 hours ago", "4 days ago" */
export function formatRelative(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (minutes < 24 * 60) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(minutes / (24 * 60));
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/** "82%" of the total, or "0%" when there is nothing to divide by. */
export function formatPercent(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

/**
 * Value for an <input type="datetime-local">, expressed in WIB. The input has
 * no time zone of its own, so the form reads and writes WIB explicitly rather
 * than trusting the browser's zone.
 */
export function toWibInput(ms: number | null): string {
  if (ms === null) return '';
  const p = wibParts(ms);
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** The reverse of toWibInput. Empty or malformed input means no expiry. */
export function fromWibInput(value: string): number | null {
  const match = INPUT_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number) as number[];
  return Date.UTC(year!, month! - 1, day!, hour!, minute!) - WIB_OFFSET_MS;
}

/**
 * Chart and tooltip labels per bucket: "15:00" for hours, "27 Sep" for days,
 * "Sep" for months, or "Sep 2026" when the series crosses a year boundary.
 */
export function formatBucketLabel(start: number, bucket: Bucket, withYear = false): string {
  const p = wibParts(start);
  if (bucket === 'hour') return `${pad(p.hour)}:00`;
  if (bucket === 'day') return `${p.day} ${MONTHS[p.month]}`;
  return withYear ? `${MONTHS[p.month]} ${p.year}` : `${MONTHS[p.month]}`;
}

/** True when the first and last month buckets fall in different years. */
export function spansYears(starts: readonly number[]): boolean {
  if (starts.length < 2) return false;
  return wibParts(starts[0]!).year !== wibParts(starts[starts.length - 1]!).year;
}
