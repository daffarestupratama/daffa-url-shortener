import { slugTakenMessage, validateSlug, type SlugAvailability } from '@daffa/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { SLUG_OWNER } from '../queries';
import { parseOptionalId } from '../validate';

/**
 * Live availability for the slug field. Always 200: an unavailable slug is an
 * answer, not a failed request. Invalid and reserved slugs are rejected without
 * touching the database. `exclude` is the link being edited, so its own slug
 * counts as available.
 */
export const slugRoutes = new Hono<AppEnv>().get('/slugs/:slug/available', async (c) => {
  const slug = c.req.param('slug');
  const exclude = parseOptionalId(c.req.query('exclude'));

  const problem = validateSlug(slug, { required: true });
  if (problem) {
    const body: SlugAvailability = { slug, available: false, code: 'invalid_slug', message: problem };
    return c.json(body);
  }

  const owner = await c.env.DB.prepare(SLUG_OWNER).bind(slug).first<{ id: number; title: string }>();
  if (owner && owner.id !== exclude) {
    const body: SlugAvailability = {
      slug,
      available: false,
      code: 'slug_taken',
      message: slugTakenMessage(owner.title),
    };
    return c.json(body);
  }

  const body: SlugAvailability = { slug, available: true };
  return c.json(body);
});
