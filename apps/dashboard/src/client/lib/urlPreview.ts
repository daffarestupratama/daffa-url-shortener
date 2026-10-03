import { canonicalUrl } from '@daffa/shared';

/**
 * The address to show as "Saved as ..." under a URL field, or null when there
 * is nothing worth showing: an empty field, or one that already reads as it
 * will be stored. It is the canonical value, with one exception for display:
 * the slash the parser adds after a bare host is left off unless it was typed,
 * so https://example.com shows nothing. Surrounding whitespace alone is not a
 * difference either. Callers hide the line while the field shows an error.
 */
export function urlPreview(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let shown = canonicalUrl(trimmed);
  if (shown.endsWith('/') && !trimmed.endsWith('/')) {
    try {
      const url = new URL(shown);
      if (url.pathname === '/' && !url.search && !url.hash) shown = shown.slice(0, -1);
    } catch {
      // Not a parsable address: shown as normalized.
    }
  }
  return shown === trimmed ? null : shown;
}
