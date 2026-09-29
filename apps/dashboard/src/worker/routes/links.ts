import { hostOf, rangeWindow, slugTakenMessage, type LinkDetail, type LinkList } from '@daffa/shared';
import { Hono } from 'hono';
import { at, first, rethrowSlugConflict, rows } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { toLink, toListItem, type LinkDbRow, type LinkListDbRow } from '../mappers';
import {
  ATTACH_TAGS_BY_ID,
  ATTACH_TAGS_BY_SLUG,
  CLEAR_LINK_TAGS,
  COUNT_LINKS,
  DELETE_LINK,
  INSERT_LINK,
  INSERT_TAGS,
  LINK_BY_ID,
  LINK_BY_SLUG,
  LINK_TOTALS,
  LIST_LINKS,
  SLUG_OWNER,
  TOGGLE_LINK,
  UPDATE_LINK,
} from '../queries';
import { likePattern, parseId, parseLinkInput, parseListQuery, readJson } from '../validate';

const LINK_NOT_FOUND = 'The link was not found.';

export const linkRoutes = new Hono<AppEnv>()
  /** One batch: the filtered list, then the unfiltered count. */
  .get('/links', async (c) => {
    const db = c.env.DB;
    const query = parseListQuery(c.req.query());
    const now = Date.now();
    const window = rangeWindow('7d', now, now);

    const results = await db.batch([
      db
        .prepare(LIST_LINKS)
        .bind(now, window.start, query.q ? likePattern(query.q) : null, query.tag, query.status, query.sort),
      db.prepare(COUNT_LINKS),
    ]);

    const body: LinkList = {
      links: rows<LinkListDbRow>(at(results, 0)).map((row) => toListItem(row, now)),
      total: first<{ total: number }>(at(results, 1))?.total ?? 0,
    };
    return c.json(body);
  })

  /**
   * One batch, and so one transaction: the link, its tags, their relations and
   * the read back. A taken slug fails the unique constraint, which rolls the
   * batch back, and only then is the owner looked up for the message.
   */
  .post('/links', async (c) => {
    const db = c.env.DB;
    const input = parseLinkInput(await readJson(c), 'create');
    // parseLinkInput guarantees both on create.
    const url = input.url as string;
    const slug = input.slug as string;
    const title = input.title || hostOf(url);
    const tagsJson = JSON.stringify(input.tags ?? []);
    const now = Date.now();

    let results: D1Result[];
    try {
      results = await db.batch([
        db
          .prepare(INSERT_LINK)
          .bind(
            slug,
            url,
            title,
            input.description ?? '',
            input.isActive === false ? 0 : 1,
            input.expiresAt ?? null,
            now,
          ),
        db.prepare(INSERT_TAGS).bind(tagsJson),
        db.prepare(ATTACH_TAGS_BY_SLUG).bind(slug, tagsJson),
        db.prepare(LINK_BY_SLUG).bind(slug),
      ]);
    } catch (error) {
      return rethrowSlugConflict(db, error, slug);
    }

    const row = first<LinkDbRow>(at(results, 3));
    if (!row) throw new Error('The created link could not be read back.');
    c.header('Location', `/api/links/${row.id}`);
    return c.json({ link: toLink(row, now) }, 201);
  })

  /** The link plus its all time totals, which the delete confirmation quotes. */
  .get('/links/:id', async (c) => {
    const db = c.env.DB;
    const id = parseId(c.req.param('id'));
    const results = await db.batch([
      db.prepare(LINK_BY_ID).bind(id),
      db.prepare(LINK_TOTALS).bind(id),
    ]);

    const row = first<LinkDbRow>(at(results, 0));
    if (!row) throw new ApiError('not_found', LINK_NOT_FOUND);
    const totals = first<{ human: number; bot: number }>(at(results, 1));

    const body: LinkDetail = {
      link: toLink(row),
      totals: { human: totals?.human ?? 0, bot: totals?.bot ?? 0 },
    };
    return c.json(body);
  })

  /**
   * Two round trips. The first reads the current row and the owner of the
   * requested slug, which the merge and the conflict message both need. The
   * second writes and reads back in one transaction.
   */
  .patch('/links/:id', async (c) => {
    const db = c.env.DB;
    const id = parseId(c.req.param('id'));
    const input = parseLinkInput(await readJson(c), 'patch');

    const before = await db.batch([
      db.prepare(LINK_BY_ID).bind(id),
      db.prepare(SLUG_OWNER).bind(input.slug ?? ''),
    ]);
    const current = first<LinkDbRow>(at(before, 0));
    if (!current) throw new ApiError('not_found', LINK_NOT_FOUND);
    const owner = first<{ id: number; title: string }>(at(before, 1));
    if (input.slug !== undefined && owner && owner.id !== id) {
      throw new ApiError('slug_taken', slugTakenMessage(owner.title));
    }

    const slug = input.slug ?? current.slug;
    const url = input.url ?? current.url;
    // An emptied title falls back to the host, of the new URL when that changed too.
    const title = (input.title ?? current.title) || hostOf(url);
    const now = Date.now();

    const statements = [
      db
        .prepare(UPDATE_LINK)
        .bind(
          id,
          slug,
          url,
          title,
          input.description ?? current.description,
          input.isActive === undefined ? current.is_active : input.isActive ? 1 : 0,
          input.expiresAt === undefined ? current.expires_at : input.expiresAt,
          now,
        ),
    ];
    if (input.tags) {
      const tagsJson = JSON.stringify(input.tags);
      statements.push(
        db.prepare(CLEAR_LINK_TAGS).bind(id),
        db.prepare(INSERT_TAGS).bind(tagsJson),
        db.prepare(ATTACH_TAGS_BY_ID).bind(id, tagsJson),
      );
    }
    statements.push(db.prepare(LINK_BY_ID).bind(id));

    let results: D1Result[];
    try {
      results = await db.batch(statements);
    } catch (error) {
      return rethrowSlugConflict(db, error, slug);
    }

    const row = first<LinkDbRow>(at(results, results.length - 1));
    if (!row) throw new ApiError('not_found', LINK_NOT_FOUND);
    return c.json({ link: toLink(row, now) });
  })

  /** Clicks and tag relations go with the link through ON DELETE CASCADE. */
  .delete('/links/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    const result = await c.env.DB.prepare(DELETE_LINK).bind(id).run();
    if (!result.meta.changes) throw new ApiError('not_found', LINK_NOT_FOUND);
    return c.body(null, 204);
  })

  /** Deactivate an active link, or reactivate an inactive or expired one. */
  .post('/links/:id/toggle', async (c) => {
    const db = c.env.DB;
    const id = parseId(c.req.param('id'));
    const now = Date.now();
    const results = await db.batch([
      db.prepare(TOGGLE_LINK).bind(id, now),
      db.prepare(LINK_BY_ID).bind(id),
    ]);
    const row = first<LinkDbRow>(at(results, 1));
    if (!row) throw new ApiError('not_found', LINK_NOT_FOUND);
    return c.json({ link: toLink(row, now) });
  });
