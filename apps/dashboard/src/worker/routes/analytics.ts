import {
  bucketStarts,
  rangeWindow,
  type Analytics,
  type ClickLogPage,
  type Range,
} from '@daffa/shared';
import { Hono } from 'hono';
import { at, first, rows } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { foldReferrers, toClickRow, type ClickDbRow } from '../mappers';
import {
  ANALYTICS_ALL_TIME,
  ANALYTICS_TOTALS,
  BOT_USER_AGENTS,
  CLICK_LOG_COUNT,
  CLICK_LOG_PAGE,
  HUMAN_USER_AGENTS,
  LINK_CREATED,
  SERIES_DAY,
  SERIES_HOUR,
  SERIES_MONTH,
  TOP_ASNS,
  TOP_CITIES,
  TOP_COLOS,
  TOP_COUNTRIES,
  TOP_REFERRERS,
} from '../queries';
import { PAGE_SIZE, parseId, parsePage, parseRange } from '../validate';

const LINK_NOT_FOUND = 'The link was not found.';

interface SeriesRow {
  bucket: number;
  human: number;
  uniq: number;
  bot: number;
}

/**
 * The lower bound used in SQL. Every range but `all` is known before the link
 * is read. `all` filters from zero, since no click predates its link, and the
 * monthly buckets are laid out afterwards from the creation date. This keeps
 * the whole endpoint to a single batch.
 */
function sqlStart(range: Range, now: number): number {
  return range === 'all' ? 0 : rangeWindow(range, now, now).start;
}

function seriesSql(range: Range): string {
  if (range === '24h') return SERIES_HOUR;
  if (range === 'all') return SERIES_MONTH;
  return SERIES_DAY;
}

export const analyticsRoutes = new Hono<AppEnv>()
  /** One batch of twelve statements, every one of them constrained by link id. */
  .get('/links/:id/analytics', async (c) => {
    const db = c.env.DB;
    const id = parseId(c.req.param('id'));
    const range = parseRange(c.req.query('range'));
    const now = Date.now();
    const start = sqlStart(range, now);
    const inRange = (sql: string) => db.prepare(sql).bind(id, start, now);

    const results = await db.batch([
      db.prepare(LINK_CREATED).bind(id),
      inRange(ANALYTICS_TOTALS),
      db.prepare(ANALYTICS_ALL_TIME).bind(id),
      inRange(seriesSql(range)),
      inRange(TOP_COUNTRIES),
      inRange(TOP_CITIES),
      inRange(TOP_REFERRERS),
      inRange(TOP_COLOS),
      inRange(TOP_ASNS),
      inRange(HUMAN_USER_AGENTS),
      inRange(BOT_USER_AGENTS),
    ]);

    const link = first<{ id: number; created_at: number }>(at(results, 0));
    if (!link) throw new ApiError('not_found', LINK_NOT_FOUND);

    const totals = first<{ human: number; bot: number; uniq: number }>(at(results, 1));
    const allTime = first<{ human: number; last_ts: number | null }>(at(results, 2));

    // SQL only returns buckets that have clicks. Lay them onto the full set of
    // buckets so the chart always gets 24, 7, 30 or 90 points.
    const window = rangeWindow(range, now, link.created_at);
    const byBucket = new Map(rows<SeriesRow>(at(results, 3)).map((row) => [row.bucket, row]));
    const series = bucketStarts(window).map((bucketStart) => {
      const row = byBucket.get(bucketStart);
      return {
        start: bucketStart,
        human: row?.human ?? 0,
        unique: row?.uniq ?? 0,
        bot: row?.bot ?? 0,
      };
    });

    const body: Analytics = {
      range,
      bucket: window.bucket,
      start: window.start,
      end: now,
      totals: {
        human: totals?.human ?? 0,
        unique: totals?.uniq ?? 0,
        bot: totals?.bot ?? 0,
      },
      allTime: {
        human: allTime?.human ?? 0,
        lastHumanAt: allTime?.last_ts ?? null,
      },
      series,
      countries: rows(at(results, 4)),
      cities: rows(at(results, 5)),
      referrers: foldReferrers(rows(at(results, 6)), 10),
      colos: rows(at(results, 7)),
      asns: rows(at(results, 8)),
      userAgents: {
        human: rows(at(results, 9)),
        bot: rows(at(results, 10)),
      },
    };
    return c.json(body);
  })

  /** Newest first, ten per page, filtered by the same range as the analytics above it. */
  .get('/links/:id/clicks', async (c) => {
    const db = c.env.DB;
    const id = parseId(c.req.param('id'));
    const range = parseRange(c.req.query('range'));
    const page = parsePage(c.req.query('page'));
    const offset = page * PAGE_SIZE;
    if (!Number.isSafeInteger(offset)) {
      throw new ApiError('bad_request', 'The page is out of range.');
    }
    const now = Date.now();
    const start = sqlStart(range, now);

    const results = await db.batch([
      db.prepare(LINK_CREATED).bind(id),
      db.prepare(CLICK_LOG_PAGE).bind(id, start, now, PAGE_SIZE, offset),
      db.prepare(CLICK_LOG_COUNT).bind(id, start, now),
    ]);

    if (!first(at(results, 0))) throw new ApiError('not_found', LINK_NOT_FOUND);

    const body: ClickLogPage = {
      rows: rows<ClickDbRow>(at(results, 1)).map(toClickRow),
      total: first<{ total: number }>(at(results, 2))?.total ?? 0,
      page,
      pageSize: PAGE_SIZE,
    };
    return c.json(body);
  });
