import { Hono } from 'hono';
import { at, first } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { blockedEntries, coveringEntry, urlHostname } from '../hosts';
import { toPublicItem, type PublicLinkDbRow } from '../mappers';
import { DELETE_PUBLIC_LINK, PUBLIC_LINK_BY_ID, SET_PUBLIC_ACTIVE } from '../queries';
import { parseId, readJson } from '../validate';

const PUBLIC_LINK_NOT_FOUND = 'The public link was not found.';

function parseActiveBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError('invalid_field', 'The request body must be a JSON object.');
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'isActive') throw new ApiError('invalid_field', `The field "${key}" is not recognized.`);
  }
  if (typeof record.isActive !== 'boolean') {
    throw new ApiError('invalid_field', 'The field "isActive" must be true or false.');
  }
  return record.isActive;
}

/**
 * Moderation of links created on the public page. The owner can switch one
 * off or on, or delete it, but never edit it: a public link stays exactly as
 * its visitor created it. Every statement requires is_public = 1, so a
 * private id answers 404 here.
 */
export const publicLinkRoutes = new Hono<AppEnv>()
  /** Enable or disable. A disabled link keeps its slug and answers 410 at the redirector. */
  .patch('/public-links/:id', async (c) => {
    const db = c.env.DB;
    const id = parseId(c.req.param('id'));
    const isActive = parseActiveBody(await readJson(c));
    const now = Date.now();
    const results = await db.batch([
      db.prepare(SET_PUBLIC_ACTIVE).bind(id, isActive ? 1 : 0, now),
      db.prepare(PUBLIC_LINK_BY_ID).bind(id),
    ]);
    const row = first<PublicLinkDbRow>(at(results, 1));
    if (!row) throw new ApiError('not_found', PUBLIC_LINK_NOT_FOUND);
    const host = urlHostname(row.url) ?? row.title;
    const blocked = coveringEntry(host, await blockedEntries(db, [host])) !== null;
    return c.json({ link: toPublicItem(row, blocked, now) });
  })

  /** Deletes the link. The slug becomes free and may be drawn for a new public link. */
  .delete('/public-links/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    const result = await c.env.DB.prepare(DELETE_PUBLIC_LINK).bind(id).run();
    if (!result.meta.changes) throw new ApiError('not_found', PUBLIC_LINK_NOT_FOUND);
    return c.body(null, 204);
  });
