/**
 * Hostname rules for public links. Everything here matches a hostname together
 * with all of its subdomains, so blocking example.com also blocks
 * www.example.com and a.b.example.com, but never notexample.com.
 */

/**
 * Other URL shorteners. A public link to one of them would hide the real
 * destination behind a second redirect, so they are rejected. The first group
 * is the list from the design, the second adds common ones it leaves out.
 */
export const SHORTENER_HOSTS: readonly string[] = [
  'bit.ly',
  'bitly.com',
  'tinyurl.com',
  's.id',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'cutt.ly',
  'rebrand.ly',
  'shorturl.at',
  'rb.gy',
  'tiny.cc',
  'lnkd.in',
  'shorturl.asia',

  'buff.ly',
  't.ly',
  'v.gd',
  'shorte.st',
  'adf.ly',
  'bl.ink',
];

/** Labels of letters, digits and inner hyphens, at least two of them. */
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A dotted quad, which is what the URL parser turns every IPv4 form into. */
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * True for an IP address in place of a hostname. Expects a hostname from the
 * URL parser, which already folds forms such as http://2130706433 or
 * http://0x7f.1 into 127.0.0.1, and keeps IPv6 inside brackets.
 */
export function isIpLiteral(host: string): boolean {
  return IPV4_RE.test(host) || host.startsWith('[');
}

/** True when `host` is `domain` itself or any subdomain of it. */
export function isOnDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** The first entry of `domains` that `host` falls under, or null. */
export function matchDomain(host: string, domains: readonly string[]): string | null {
  return domains.find((domain) => isOnDomain(host, domain)) ?? null;
}

/**
 * Every domain `host` falls under, longest first. `a.b.example.com` gives
 * `a.b.example.com`, `b.example.com`, `example.com`, and `com`. A stored list
 * can then be checked with one indexed `IN` lookup instead of being loaded.
 */
export function hostSuffixes(host: string): string[] {
  const labels = host.split('.');
  return labels.map((_, index) => labels.slice(index).join('.'));
}

/**
 * Turns user input such as `Example.COM.`, `https://www.example.com/path`, or
 * an internationalized name into the lowercase ASCII hostname the URL parser
 * produces, or null when the input is not a dotted hostname. IP addresses are
 * rejected, since only names can be blocked by domain.
 */
export function normalizeHost(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let host: string;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    host = new URL(withScheme).hostname;
  } catch {
    return null;
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (isIpLiteral(host) || !HOSTNAME_RE.test(host)) return null;
  return host;
}
