import { describe, expect, it } from 'vitest';
import { purgeCounters, purgeCutoffs, scheduled } from './cron';
import type { Env } from './env';
import { PURGE_BUDGET, PURGE_RATE_LIMITS } from './queries';
import { fakeD1 } from './testing/fakeD1';

const RUN = Date.UTC(2026, 9, 2, 0, 15, 3);

describe('daily purge', () => {
  it('keeps one day of rate limit windows and seven days of budget rows', () => {
    expect(purgeCutoffs(RUN)).toEqual({
      rateLimits: Date.UTC(2026, 9, 1, 0, 0, 0),
      budget: Date.UTC(2026, 8, 25),
    });
  });

  it('deletes both in one batch and reports the counts', async () => {
    const d1 = fakeD1((sql) => ({ changes: sql === PURGE_RATE_LIMITS ? 42 : 3 }));
    expect(await purgeCounters(d1.db, RUN)).toEqual({ rateLimits: 42, budget: 3 });
    expect(d1.calls).toEqual([
      { sql: PURGE_RATE_LIMITS, params: [Date.UTC(2026, 9, 1, 0, 0, 0)] },
      { sql: PURGE_BUDGET, params: [Date.UTC(2026, 8, 25)] },
    ]);
  });

  it('runs from the scheduled time of the trigger, not the clock', async () => {
    const d1 = fakeD1();
    const controller = { scheduledTime: RUN, cron: '15 0 * * *', noRetry() {} } as ScheduledController;
    await scheduled(controller, { DB: d1.db } as Env);
    expect(d1.paramsOf(PURGE_BUDGET)).toEqual([Date.UTC(2026, 8, 25)]);
  });

  it('rethrows a failure so the run shows as failed', async () => {
    const d1 = fakeD1(() => new Error('D1_ERROR: database is locked'));
    const controller = { scheduledTime: RUN, cron: '15 0 * * *', noRetry() {} } as ScheduledController;
    await expect(scheduled(controller, { DB: d1.db } as Env)).rejects.toThrow('D1_ERROR');
  });
});
