import { SHORTENER_HOSTS, isIpLiteral, isOnDomain, matchDomain } from './domains';
import { PUBLIC_URL_MAX_LENGTH } from './public';

/** One message for both rule sets, since a bare domain such as example.com is now accepted. */
export const INVALID_URL_FORMAT =
  'Invalid URL format. Enter a web address such as example.com or https://example.com/page.';
const REDIRECT_LOOP =
  'Destination URL cannot point to daffa.me because it would create a redirect loop.';

/**
 * Only the apex and its www alias would loop back into the redirector. Every
 * other daffa.me subdomain, link.daffa.me included, is a valid destination
 * for a private link.
 */
const LOOP_HOSTS: readonly string[] = ['daffa.me', 'www.daffa.me'];

export interface ValidateUrlOptions {
  /** Report an empty value as an error. */
  required?: boolean;
}

const EXPLICIT_HTTP = /^https?:\/\//i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** host:port with nothing that could be a scheme, such as example.com:8080/x or localhost:3000. */
const HOST_PORT = /^[^/?#:@]+:\d+(?:[/?#]|$)/;

/**
 * Turns what a person pastes or types into the address that is validated and
 * stored. It only rewrites text, the validators decide what is acceptable.
 *
 *   example.com/path        https://example.com/path
 *   HTTP://Example.com/A    http://Example.com/A   (scheme lowercased, rest as typed)
 *   //example.com           https://example.com
 *   localhost:3000          https://localhost:3000 (then rejected, no dot in the host)
 *   javascript:alert(1)     unchanged              (then rejected, not http or https)
 *
 * A host:port shape counts as having no scheme. The result then always carries
 * https, so the dotted hostname rule still decides. Applying it twice changes
 * nothing.
 */
export function normalizeUrlInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (EXPLICIT_HTTP.test(trimmed)) {
    const colon = trimmed.indexOf(':');
    return trimmed.slice(0, colon).toLowerCase() + trimmed.slice(colon);
  }
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (ANY_SCHEME.test(trimmed) && !HOST_PORT.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * The form a destination is stored in: normalizeUrlInput, then the parser's
 * own serialization for http and https. That repairs what the parser accepts
 * but a person would not expect to keep, and lowercases the scheme and host:
 *
 *   http:example.com/x      http://example.com/x
 *   https:/example.com/x    https://example.com/x
 *   HTTPS://EXAMPLE.com/A   https://example.com/A
 *   example.com             https://example.com/   (a bare host gains its slash)
 *
 * Anything that does not parse as http or https comes back normalized but
 * otherwise unchanged, so the validators still see and reject it. Applying it
 * twice changes nothing.
 */
export function canonicalUrl(value: string): string {
  const normalized = normalizeUrlInput(value);
  const url = parseHttp(normalized);
  return url ? url.href : normalized;
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
  const normalized = normalizeUrlInput(value);
  if (!normalized) {
    return options.required ? 'Destination URL is required.' : null;
  }
  const url = parseHttp(normalized);
  if (!url || !url.hostname.includes('.')) {
    return INVALID_URL_FORMAT;
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
 * from the public page design. Input is normalized first, like validateUrl. The order matters: the first failing rule is
 * the one reported. The blocked domain list lives in the database, so that
 * check runs on the server only, with blockedDomainMessage for its copy.
 */
export function checkPublicUrl(value: string): PublicUrlError | null {
  const normalized = normalizeUrlInput(value);
  if (!normalized) {
    return { code: 'required', message: 'Destination URL is required.' };
  }
  // Measured after normalization, so a prefix that pushes it over still counts.
  if (normalized.length > PUBLIC_URL_MAX_LENGTH) {
    return {
      code: 'too_long',
      message: `Destination URL must be ${PUBLIC_URL_MAX_LENGTH} characters or fewer.`,
    };
  }
  const url = parseHttp(normalized);
  let host = url?.hostname.toLowerCase() ?? '';
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (url && isIpLiteral(host)) {
    return {
      code: 'ip',
      message: 'IP addresses are not accepted as destinations. Use the domain name of the site instead.',
    };
  }
  if (!url || !host.includes('.')) {
    return { code: 'invalid', message: INVALID_URL_FORMAT };
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
