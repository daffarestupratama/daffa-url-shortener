import { SHORTENER_HOSTS, isIpLiteral, isOnDomain, matchDomain } from './domains';
import { PUBLIC_URL_MAX_LENGTH } from './public';

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

/** Parses an http or https address, or returns null for anything else. */
function parseHttp(value: string): URL | null {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

/** Returns an error message, or null when the destination URL is acceptable. */
export function validateUrl(value: string, options: ValidateUrlOptions = {}): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return options.required ? 'Destination URL is required.' : null;
  }
  const url = parseHttp(trimmed);
  if (!url || !url.hostname.includes('.')) {
    return INVALID_FORMAT;
  }
  if (LOOP_HOSTS.includes(url.hostname.toLowerCase())) {
    return REDIRECT_LOOP;
  }
  return null;
}

export type PublicUrlErrorCode = 'required' | 'too_long' | 'invalid' | 'loop' | 'ip' | 'shortener';

export interface PublicUrlError {
  code: PublicUrlErrorCode;
  message: string;
}

/**
 * The stricter rules for links created by anonymous visitors, with the copy
 * from the public page design. The order matters: the first failing rule is
 * the one reported. The blocked domain list lives in the database, so that
 * check runs on the server only, with blockedDomainMessage for its copy.
 */
export function checkPublicUrl(value: string): PublicUrlError | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return { code: 'required', message: 'Destination URL is required.' };
  }
  if (trimmed.length > PUBLIC_URL_MAX_LENGTH) {
    return {
      code: 'too_long',
      message: `Destination URL must be ${PUBLIC_URL_MAX_LENGTH} characters or fewer.`,
    };
  }
  const url = parseHttp(trimmed);
  let host = url?.hostname.toLowerCase() ?? '';
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (url && isIpLiteral(host)) {
    return {
      code: 'ip',
      message: 'IP addresses are not accepted as destinations. Use the domain name of the site instead.',
    };
  }
  if (!url || !host.includes('.')) {
    return {
      code: 'invalid',
      message: 'Invalid URL format. Use a full address that starts with https://',
    };
  }
  // Every daffa.me host is refused here, not only the apex: s.daffa.me
  // forwards to the redirector and link.daffa.me is the public page itself.
  if (isOnDomain(host, 'daffa.me')) {
    return {
      code: 'loop',
      message:
        'Destination URL cannot point to daffa.me because the short link would redirect back to itself.',
    };
  }
  if (matchDomain(host, SHORTENER_HOSTS)) {
    return {
      code: 'shortener',
      message: `Links from other URL shorteners such as ${host.replace(/^www\./, '')} are not accepted. Use the final destination address instead.`,
    };
  }
  return null;
}

/** The message for a destination under a blocked domain. */
export function blockedDomainMessage(host: string): string {
  return `The domain ${host} is blocked for public links and cannot be shortened.`;
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
