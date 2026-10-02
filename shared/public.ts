import { GENERATED_SLUG_LENGTH, RESERVED, SLUG_ALPHABET } from './slug';
import { utcDayStart } from './time';

/**
 * Limits for public links. Fixed windows: creation counts per clock hour, and
 * clicks count per UTC day, which starts at 07:00 WIB and matches the moment
 * Cloudflare resets its free plan quotas. Private links are never limited.
 */
export const PUBLIC_DAILY_CLICK_LIMIT = 500;
export const PUBLIC_DAILY_CLICK_BUDGET = 20_000;
export const PUBLIC_CREATE_PER_IP_HOUR = 5;
export const PUBLIC_CREATE_GLOBAL_HOUR = 30;
export const PUBLIC_URL_MAX_LENGTH = 2048;

/** Exactly six characters from the generator alphabet, nothing else. */
export const PUBLIC_SLUG_RE = new RegExp(`^[${SLUG_ALPHABET}]{${GENERATED_SLUG_LENGTH}}$`);

/**
 * The only slugs a public link may carry. Reserved words still apply, since
 * `assets` and `static` happen to fit the alphabet.
 */
export function isPublicSlug(slug: string): boolean {
  return PUBLIC_SLUG_RE.test(slug) && !RESERVED.includes(slug);
}

type FillRandom = (bytes: Uint8Array) => Uint8Array;

const cryptoFill: FillRandom = (bytes) => crypto.getRandomValues(bytes);

/**
 * A random public slug from the Web Crypto source, available in browsers and
 * Workers alike. The alphabet has 32 characters, so the low five bits of each
 * byte pick one without bias. Reserved words are drawn again.
 */
export function randomPublicSlug(fill: FillRandom = cryptoFill): string {
  for (;;) {
    const bytes = fill(new Uint8Array(GENERATED_SLUG_LENGTH));
    let slug = '';
    for (const byte of bytes) slug += SLUG_ALPHABET.charAt(byte & 31);
    if (!RESERVED.includes(slug)) return slug;
  }
}

/**
 * Clicks a public link received today. The counter on the row belongs to the
 * UTC day in `clickDay`, so a counter from an earlier day reads as zero.
 */
export function clicksToday(clickDay: number, clickToday: number, now: number = Date.now()): number {
  return clickDay === utcDayStart(now) ? clickToday : 0;
}

/** True once a public link has used its daily clicks. */
export function isLinkCapReached(
  clickDay: number,
  clickToday: number,
  now: number = Date.now(),
): boolean {
  return clicksToday(clickDay, clickToday, now) >= PUBLIC_DAILY_CLICK_LIMIT;
}

/** True once all public links together have used the shared daily budget. */
export function isBudgetReached(clicksUsed: number | null): boolean {
  return (clicksUsed ?? 0) >= PUBLIC_DAILY_CLICK_BUDGET;
}
