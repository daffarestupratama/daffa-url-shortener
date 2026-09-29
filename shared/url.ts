const INVALID_FORMAT = 'Invalid URL format. Use a full address starting with https://';
const REDIRECT_LOOP =
  'Destination URL cannot point to daffa.me because it would create a redirect loop.';

/**
 * Only the apex and its www alias would loop back into the redirector. Every
 * other daffa.me subdomain, shorten.daffa.me included, is a valid destination.
 */
const LOOP_HOSTS: readonly string[] = ['daffa.me', 'www.daffa.me'];

export interface ValidateUrlOptions {
  /** Report an empty value as an error. */
  required?: boolean;
}

/** Returns an error message, or null when the destination URL is acceptable. */
export function validateUrl(value: string, options: ValidateUrlOptions = {}): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return options.required ? 'Destination URL is required.' : null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return INVALID_FORMAT;
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) {
    return INVALID_FORMAT;
  }
  if (LOOP_HOSTS.includes(url.hostname.toLowerCase())) {
    return REDIRECT_LOOP;
  }
  return null;
}

/** Strips the scheme and a leading www, for the shortened form shown in lists. */
export function hostPath(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '');
}

/** The host on its own, used as the fallback title when the field is empty. */
export function hostOf(url: string): string {
  const path = hostPath(url.trim());
  return path.split('/')[0] ?? '';
}
