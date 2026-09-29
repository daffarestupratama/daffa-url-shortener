import { rangeWindow, type Summary } from '@daffa/shared';
import { Hono } from 'hono';
import { at, first } from '../db';
import type { AppEnv } from '../env';
import { SUMMARY_CLICKS, SUMMARY_COUNTS, SUMMARY_TOP } from '../queries';

interface CountsRow {
  total: number;
  active: number;
}

interface ClicksRow {
  human: number;
  uniq: number;
}

interface TopRow {
  id: number;
  slug: string;
  title: string;
  clicks: number;
}

/** The KPI row above the links list. One batch, three statements. */
export const summaryRoutes = new Hono<AppEnv>().get('/summary', async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  // The same 7 day WIB window as the list, so the caption reads 21 to 27 Sep on 27 Sep.
  const window = rangeWindow('7d', now, now);

  const results = await db.batch([
    db.prepare(SUMMARY_COUNTS).bind(now),
    db.prepare(SUMMARY_CLICKS).bind(window.start),
    db.prepare(SUMMARY_TOP).bind(window.start),
  ]);

  const counts = first<CountsRow>(at(results, 0));
  const clicks = first<ClicksRow>(at(results, 1));
  const top = first<TopRow>(at(results, 2));

  const summary: Summary = {
    total: counts?.total ?? 0,
    active: counts?.active ?? 0,
    human7d: clicks?.human ?? 0,
    unique7d: clicks?.uniq ?? 0,
    top: top ? { id: top.id, slug: top.slug, title: top.title, clicks: top.clicks } : null,
    windowStart: window.start,
    windowEnd: window.end,
  };
  return c.json(summary);
});
