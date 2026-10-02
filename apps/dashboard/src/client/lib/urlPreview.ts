import { normalizeUrlInput } from '@daffa/shared';

/**
 * The address to show as "Saved as ..." under a URL field, or null when there
 * is nothing worth showing: an empty field, or one that already reads exactly
 * as it will be stored. Surrounding whitespace alone is not a difference.
 * Callers hide the line while the field shows an error.
 */
export function urlPreview(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = normalizeUrlInput(trimmed);
  return normalized === trimmed ? null : normalized;
}
