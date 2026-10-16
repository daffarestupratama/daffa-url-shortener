import { DAY_MS, hourStart, utcDayStart } from '@daffa/shared';
import { at } from './db';
import type { Env } from './env';
import { PURGE_BUDGET, PURGE_GUARD_BLOCKS, PURGE_RATE_LIMITS } from './queries';

/** Rate limit windows are only read for the current hour, a day of history is plenty. */
export const RATE_LIMIT_KEEP_MS = DAY_MS;
/** A week of daily budget rows stays, for a look back at recent public traffic. */
export const BUDGET_KEEP_DAYS = 7;

export interface PurgeResult {
  rateLimits: number;
  budget: number;
  guardBlocks: number;
}

/**
 * The cutoffs for a run at `time`. Rows strictly before them are deleted.
 * A guard block is only read while it lasts, so it goes once it has ended.
 */
export function purgeCutoffs(time: number): Record<keyof PurgeResult, number> {
  return {
    rateLimits: hourStart(time) - RATE_LIMIT_KEEP_MS,
    budget: utcDayStart(time) - BUDGET_KEEP_DAYS * DAY_MS,
    guardBlocks: time,
  };
}

/** Every delete in one batch, so one round trip. */
export async function purgeCounters(db: D1Database, time: number): Promise<PurgeResult> {
  const cutoffs = purgeCutoffs(time);
  const results = await db.batch([
    db.prepare(PURGE_RATE_LIMITS).bind(cutoffs.rateLimits),
    db.prepare(PURGE_BUDGET).bind(cutoffs.budget),
    db.prepare(PURGE_GUARD_BLOCKS).bind(cutoffs.guardBlocks),
  ]);
  return {
    rateLimits: at(results, 0).meta.changes ?? 0,
    budget: at(results, 1).meta.changes ?? 0,
    guardBlocks: at(results, 2).meta.changes ?? 0,
  };
}

/**
 * The daily cron at 00:15 UTC, just after the public limits reset. A failure
 * is logged and rethrown, so the run shows as failed under Cron Events.
 * Locally: npm run cron:local while npm run dev is running.
 */
export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  try {
    const removed = await purgeCounters(env.DB, controller.scheduledTime);
    console.log(
      `purged ${removed.rateLimits} rate limit rows, ${removed.budget} daily budget rows, and ${removed.guardBlocks} guard block rows`,
    );
  } catch (error) {
    console.error('daily purge failed', error);
    throw error;
  }
}
