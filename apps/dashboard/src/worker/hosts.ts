import { hostSuffixes, isOnDomain, publicTitle } from '@daffa/shared';
import { rows } from './db';
import { BLOCKED_MATCH, PUBLIC_HOST_CANDIDATES } from './queries';

/** The hostname of a stored URL, lowercase and without a trailing dot, or null. */
export function urlHostname(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('.') ? host.slice(0, -1) : host;
  } catch {
    return null;
  }
}

/**
 * Parameters for PUBLIC_HOST_CANDIDATES. Titles are hostnames without www,
 * so the title of a link on `host` is either the host without www or ends in
 * a dot plus the host. The query returns a superset, which linksOnDomain
 * settles exactly.
 */
export function candidateParams(host: string): [string, string] {
  return [publicTitle(host), `%.${host}`];
}

/**
 * Keeps the rows whose URL host is `host` or a subdomain of it. The title
 * alone cannot decide this for a host that starts with www: blocking
 * www.example.com must not touch a link to example.com, whose title is the
 * same.
 */
export function linksOnDomain<T extends { url: string }>(candidates: readonly T[], host: string): T[] {
  return candidates.filter((row) => {
    const hostname = urlHostname(row.url);
    return hostname !== null && isOnDomain(hostname, host);
  });
}

/** Active public links that a block of `host` would disable. */
export async function activePublicLinksOn(db: D1Database, host: string): Promise<{ id: number; url: string }[]> {
  const result = await db
    .prepare(PUBLIC_HOST_CANDIDATES)
    .bind(...candidateParams(host))
    .all<{ id: number; url: string }>();
  return linksOnDomain(result.results, host);
}

/** Every suffix of every host, without repeats, as the JSON parameter of BLOCKED_MATCH. */
export function suffixesJson(hosts: readonly string[]): string {
  return JSON.stringify([...new Set(hosts.flatMap(hostSuffixes))]);
}

/** The blocked entries among the suffixes of `hosts`, in one indexed query. */
export async function blockedEntries(db: D1Database, hosts: readonly string[]): Promise<Set<string>> {
  if (hosts.length === 0) return new Set();
  const result = await db.prepare(BLOCKED_MATCH).bind(suffixesJson(hosts)).all<{ host: string }>();
  return new Set(rows<{ host: string }>(result).map((row) => row.host));
}

/** The blocked entry covering `host`, the widest one first, or null. */
export function coveringEntry(host: string, blocked: ReadonlySet<string>): string | null {
  const matches = hostSuffixes(host).filter((suffix) => blocked.has(suffix));
  return matches[matches.length - 1] ?? null;
}
