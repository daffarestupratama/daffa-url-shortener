import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { TAGS_IN_USE } from '../queries';

/** Tags attached to at least one link. Tags left behind by edits are filtered out here. */
export const tagRoutes = new Hono<AppEnv>().get('/tags', async (c) => {
  const result = await c.env.DB.prepare(TAGS_IN_USE).all<{ name: string }>();
  return c.json({ tags: result.results.map((row) => row.name) });
});
