import type { BlockDomainResult, BlockedDomainCheck, BlockedDomainList } from '@daffa/shared';
import { Hono } from 'hono';
import { at, first, rows } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { activePublicLinksOn, blockedEntries, candidateParams, coveringEntry, linksOnDomain } from '../hosts';
import {
  BLOCKED_BY_HOST,
  BLOCKED_COUNT,
  BLOCKED_DELETE,
  BLOCKED_INSERT,
  BLOCKED_LIST,
  DISABLE_IDS,
  PUBLIC_HOST_CANDIDATES,
} from '../queries';
import { likePattern, parseHostInput, parseSearch, readJson } from '../validate';

interface BlockedDbRow {
  host: string;
  created_at: number;
}

const toDomain = (row: BlockedDbRow) => ({ host: row.host, createdAt: row.created_at });

function parseBlockBody(body: unknown): { host: string; disableActive: boolean } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError('invalid_field', 'The request body must be a JSON object.');
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'host' && key !== 'disableActive') {
      throw new ApiError('invalid_field', `The field "${key}" is not recognized.`);
    }
  }
  if (record.disableActive !== undefined && typeof record.disableActive !== 'boolean') {
    throw new ApiError('invalid_field', 'The field "disableActive" must be true or false.');
  }
  return { host: parseHostInput(record.host), disableActive: record.disableActive === true };
}

/**
 * Hostnames refused for new public links. An entry covers the host and every
 * subdomain. Input goes through normalizeHost, so a pasted URL, mixed case, a
 * trailing dot, or an internationalized name all land on one canonical entry.
 * Private links are never checked against this list.
 */
export const blockedRoutes = new Hono<AppEnv>()
  /** The whole list, newest first, optionally narrowed by a search. One batch. */
  .get('/blocked-domains', async (c) => {
    const db = c.env.DB;
    const q = parseSearch(c.req.query('q'));
    const results = await db.batch([
      db.prepare(BLOCKED_LIST).bind(q ? likePattern(q) : null),
      db.prepare(BLOCKED_COUNT),
    ]);
    const body: BlockedDomainList = {
      domains: rows<BlockedDbRow>(at(results, 0)).map(toDomain),
      total: first<{ total: number }>(at(results, 1))?.total ?? 0,
    };
    return c.json(body);
  })

  /** What the block dialog shows before anything changes. */
  .get('/blocked-domains/check', async (c) => {
    const db = c.env.DB;
    const host = parseHostInput(c.req.query('host'));
    const [blocked, active] = await Promise.all([blockedEntries(db, [host]), activePublicLinksOn(db, host)]);
    const body: BlockedDomainCheck = {
      host,
      blockedBy: coveringEntry(host, blocked),
      activePublicLinks: active.length,
    };
    return c.json(body);
  })

  /**
   * Adds the host, 201 when new and 200 when it was listed already. With
   * disableActive, every active public link on the host or a subdomain is
   * switched off too. Disabled links keep their slugs and can be enabled later.
   */
  .post('/blocked-domains', async (c) => {
    const db = c.env.DB;
    const { host, disableActive } = parseBlockBody(await readJson(c));
    const now = Date.now();

    const statements = [db.prepare(BLOCKED_INSERT).bind(host, now), db.prepare(BLOCKED_BY_HOST).bind(host)];
    if (disableActive) statements.push(db.prepare(PUBLIC_HOST_CANDIDATES).bind(...candidateParams(host)));
    const results = await db.batch(statements);

    const created = (at(results, 0).meta.changes ?? 0) > 0;
    const row = first<BlockedDbRow>(at(results, 1));
    if (!row) throw new Error('The blocked domain could not be read back.');

    let disabled = 0;
    if (disableActive) {
      const ids = linksOnDomain(rows<{ id: number; url: string }>(at(results, 2)), host).map((link) => link.id);
      if (ids.length > 0) {
        const result = await db.prepare(DISABLE_IDS).bind(now, JSON.stringify(ids)).run();
        disabled = result.meta.changes ?? 0;
      }
    }

    const body: BlockDomainResult = { domain: toDomain(row), created, disabled };
    return c.json(body, created ? 201 : 200);
  })

  /** Removes the entry. Links disabled when it was added stay disabled. */
  .delete('/blocked-domains/:host', async (c) => {
    const host = parseHostInput(c.req.param('host'));
    const result = await c.env.DB.prepare(BLOCKED_DELETE).bind(host).run();
    if (!result.meta.changes) throw new ApiError('not_found', 'The domain is not on the blocked list.');
    return c.body(null, 204);
  });
