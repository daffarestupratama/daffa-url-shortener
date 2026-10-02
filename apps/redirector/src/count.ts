import { COUNT_BUDGET, COUNT_LINK } from './sql';

/**
 * Records one served public link visit as counters only: the link total, the
 * link count for today, and the shared daily budget. No clicks row is written,
 * so nothing about the visitor is kept. Called through ctx.waitUntil, and both
 * writes go in one batch, which is one round trip and one transaction.
 */
export async function countPublicClick(db: D1Database, linkId: number, day: number): Promise<void> {
  try {
    await db.batch([db.prepare(COUNT_LINK).bind(linkId, day), db.prepare(COUNT_BUDGET).bind(day)]);
  } catch (error) {
    // A failed count must never affect the page the visitor already received.
    console.error('public click count failed', error);
  }
}
