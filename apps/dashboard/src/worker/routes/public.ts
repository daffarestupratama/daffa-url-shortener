import {
  PUBLIC_CREATE_GLOBAL_HOUR,
  PUBLIC_CREATE_PER_IP_HOUR,
  PUBLIC_URL_MAX_LENGTH,
  SHORT_LINK_ORIGIN,
  blockedDomainMessage,
  checkPublicUrl,
  hourStart,
  nextHourStart,
  normalizeUrlInput,
  publicTitle,
  randomPublicSlug,
  secondsUntil,
  type PublicCreateResult,
} from '@daffa/shared';
import { Hono } from 'hono';
import { isDevBypass } from '../auth';
import { at, first, isSlugConflict, rows } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { blockedEntries, coveringEntry, urlHostname } from '../hosts';
import { PUBLIC_CREATED, PUBLIC_INSERT, RATE_BUMP, RATE_READ } from '../queries';
import { GLOBAL_BUCKET, ipBucket } from '../ratelimit';
import { verifyTurnstile } from '../turnstile';
import { parsePublicCreateBody, readJson } from '../validate';

/** A taken slug is replaced by a random one. Three draws from 32^6 never all collide in practice. */
const MAX_SLUG_ATTEMPTS = 3;

export interface PublicRouteOptions {
  /** Injectable for tests: siteverify, the clock, and the slug source. */
  fetcher?: typeof fetch;
  now?: () => number;
  randomSlug?: () => string;
}

/**
 * The anonymous API behind link.daffa.me. No Access, so everything here is
 * written for strangers: nothing about the owner, other links, tags, or
 * counters ever leaves, and every refusal is decided as cheaply as possible.
 *
 * POST /links checks in this order and stops at the first failure:
 *   0. both secrets configured, or 500 (fail closed)
 *      CSRF and the 8 KB body limit run before this route as middleware
 *   1. body shape, slug format, token present, or 400 or 403
 *   2. checkPublicUrl on the normalized URL, or 400
 *   3. blocked domain, one indexed query, or 400
 *   4. Turnstile siteverify, or 403 (rejected) or 503 (no answer)
 *   5. hourly limits and the insert, in one transaction, or 429
 * Steps 1 to 3 never call Turnstile, and nothing before step 5 reads or writes
 * a rate limit counter.
 *
 * CPU stays far below the 10 ms limit: a small JSON parse, two URL parses,
 * a handful of string operations, and one HMAC that WebCrypto computes
 * natively. D1 and siteverify are waits on I/O, which do not count as CPU.
 */
export function createPublicRoutes({
  fetcher,
  now = Date.now,
  randomSlug = () => randomPublicSlug(),
}: PublicRouteOptions = {}) {
  return new Hono<AppEnv>().post('/links', async (c) => {
    const turnstileSecret = c.env.TURNSTILE_SECRET?.trim();
    const rateSecret = c.env.RATE_LIMIT_SECRET?.trim();
    if (!turnstileSecret || !rateSecret) {
      console.error('TURNSTILE_SECRET or RATE_LIMIT_SECRET is not set.');
      throw new ApiError('public_not_configured');
    }

    const input = parsePublicCreateBody(await readJson(c));

    const problem = checkPublicUrl(input.url);
    if (problem) throw new ApiError('invalid_url', problem.message, { reason: problem.code });
    // Stored in the parser's own form: lowercase scheme and host, punycode,
    // percent encoding. checkPublicUrl has parsed it already, so this succeeds.
    const url = new URL(normalizeUrlInput(input.url)).href;
    if (url.length > PUBLIC_URL_MAX_LENGTH) {
      throw new ApiError('invalid_url', `Destination URL must be ${PUBLIC_URL_MAX_LENGTH} characters or fewer.`, {
        reason: 'too_long',
      });
    }
    const hostname = urlHostname(url) ?? '';
    const title = publicTitle(hostname);

    const db = c.env.DB;
    if (coveringEntry(hostname, await blockedEntries(db, [hostname]))) {
      throw new ApiError('blocked_domain', blockedDomainMessage(title));
    }

    const ip = c.req.header('cf-connecting-ip') ?? null;
    const outcome = await verifyTurnstile({
      secret: turnstileSecret,
      token: input.turnstileToken,
      remoteIp: ip,
      devBypass: isDevBypass(c.env, new URL(c.req.url)),
      fetcher,
    });
    if (outcome === 'unavailable') throw new ApiError('turnstile_unavailable');
    if (outcome === 'failed') throw new ApiError('turnstile_failed');

    const bucket = await ipBucket(rateSecret, ip);
    const createdAt = now();
    const windowStart = hourStart(createdAt);
    const buckets = JSON.stringify([bucket, GLOBAL_BUCKET]);

    let slug = input.slug ?? randomSlug();
    for (let attempt = 1; ; attempt += 1) {
      let results: D1Result[];
      try {
        results = await db.batch([
          db
            .prepare(PUBLIC_INSERT)
            .bind(slug, url, title, createdAt, windowStart, bucket, PUBLIC_CREATE_PER_IP_HOUR, PUBLIC_CREATE_GLOBAL_HOUR),
          db.prepare(RATE_BUMP).bind(windowStart, buckets, slug, createdAt),
          db.prepare(PUBLIC_CREATED).bind(slug, createdAt),
          db.prepare(RATE_READ).bind(windowStart, bucket),
        ]);
      } catch (error) {
        // The batch rolled back as a whole, so no counter moved. Draw again.
        if (!isSlugConflict(error) || attempt >= MAX_SLUG_ATTEMPTS) throw error;
        slug = randomSlug();
        continue;
      }

      const row = first<{ slug: string; url: string; created_at: number }>(at(results, 2));
      if (row) {
        const body: PublicCreateResult = {
          slug: row.slug,
          shortUrl: `${SHORT_LINK_ORIGIN}/${row.slug}`,
          url: row.url,
          createdAt: row.created_at,
        };
        return c.json(body, 201);
      }

      // Nothing was inserted, so one of the hourly limits is used up. The
      // visitor's own limit is named first, since it is the one they control.
      const counts = rows<{ bucket: string; count: number }>(at(results, 3));
      const own = counts.find((entry) => entry.bucket === bucket)?.count ?? 0;
      const resetAt = nextHourStart(createdAt);
      throw new ApiError(
        own >= PUBLIC_CREATE_PER_IP_HOUR ? 'rate_limited_ip' : 'rate_limited_global',
        undefined,
        { resetAt },
        { 'Retry-After': String(secondsUntil(resetAt, createdAt)) },
      );
    }
  });
}

export const publicRoutes = createPublicRoutes();
