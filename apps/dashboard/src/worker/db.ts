import { slugTakenMessage } from '@daffa/shared';
import { ApiError } from './errors';
import { SLUG_OWNER } from './queries';

/** First row of a batch result, typed by the caller. */
export function first<T>(result: D1Result | undefined): T | undefined {
  return result?.results?.[0] as T | undefined;
}

/** All rows of a batch result, typed by the caller. */
export function rows<T>(result: D1Result | undefined): T[] {
  return (result?.results ?? []) as T[];
}

/** A batch result that must exist, for positional destructuring. */
export function at(results: D1Result[], index: number): D1Result {
  const result = results[index];
  if (!result) throw new Error(`D1 batch returned no result at position ${index}.`);
  return result;
}

/** True for the unique constraint failure on links.slug, the sign of a taken slug. */
export function isSlugConflict(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed: links\.slug/.test(error.message);
}

/**
 * Turns a unique constraint failure on links.slug into a 409 that names the
 * link already holding the slug. Any other error is rethrown untouched. The
 * lookup only runs on a conflict, so the happy path stays one round trip.
 */
export async function rethrowSlugConflict(db: D1Database, error: unknown, slug: string): Promise<never> {
  if (isSlugConflict(error)) {
    const owner = await db.prepare(SLUG_OWNER).bind(slug).first<{ id: number; title: string }>();
    throw new ApiError('slug_taken', slugTakenMessage(owner?.title ?? slug));
  }
  throw error;
}
