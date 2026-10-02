import {
  clicksToday,
  deriveStatus,
  isLinkCapReached,
  type ClickRow,
  type Link,
  type LinkListItem,
  type LinkRow,
  type PublicLinkItem,
} from '@daffa/shared';

/** A links row joined with its tags as a JSON array string. */
export interface LinkDbRow extends LinkRow {
  tags: string | null;
}

export interface LinkListDbRow extends LinkDbRow {
  clicks7d: number;
}

/** A public link row as LIST_SQL.public and PUBLIC_LINK_BY_ID return it. */
export interface PublicLinkDbRow {
  id: number;
  slug: string;
  url: string;
  title: string;
  is_active: number;
  created_at: number;
  updated_at: number;
  click_total: number;
  click_day: number;
  click_today: number;
}

export interface ClickDbRow {
  id: number;
  ts: number;
  ip: string;
  ua: string;
  is_bot: number;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  colo: string | null;
  asn: number | null;
  as_org: string | null;
  referrer: string | null;
}

function parseTags(json: string | null): string[] {
  if (!json) return [];
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
}

export function toLink(row: LinkDbRow, now: number = Date.now()): Link {
  const isActive = row.is_active === 1;
  return {
    id: row.id,
    slug: row.slug,
    url: row.url,
    title: row.title,
    description: row.description,
    isActive,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags: parseTags(row.tags),
    status: deriveStatus(isActive, row.expires_at, now),
  };
}

export function toListItem(row: LinkListDbRow, now: number = Date.now()): LinkListItem {
  return { ...toLink(row, now), clicks7d: row.clicks7d };
}

/**
 * Public links never expire, so the status is active or inactive. Today's
 * count comes from the counters the redirector keeps, read with the same
 * helpers the redirector uses to enforce the daily limit.
 */
export function toPublicItem(row: PublicLinkDbRow, domainBlocked: boolean, now: number = Date.now()): PublicLinkItem {
  const isActive = row.is_active === 1;
  return {
    id: row.id,
    slug: row.slug,
    url: row.url,
    host: row.title,
    isActive,
    status: deriveStatus(isActive, null, now),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clickTotal: row.click_total,
    clicksToday: clicksToday(row.click_day, row.click_today, now),
    limitReached: isLinkCapReached(row.click_day, row.click_today, now),
    domainBlocked,
  };
}

export function toClickRow(row: ClickDbRow): ClickRow {
  return {
    id: row.id,
    ts: row.ts,
    ip: row.ip,
    ua: row.ua,
    isBot: row.is_bot === 1,
    country: row.country,
    region: row.region,
    city: row.city,
    timezone: row.timezone,
    colo: row.colo,
    asn: row.asn,
    asOrg: row.as_org,
    referrer: row.referrer,
  };
}

/**
 * The hostname shown in the REFERRER ranking, without a leading www. Null means
 * a direct visit. A value that is not a URL is kept as sent, shortened.
 */
export function referrerHost(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return referrer.slice(0, 100);
  }
}

/** Folds referrer URLs into hostnames, summing counts, largest first. */
export function foldReferrers(
  rows: ReadonlyArray<{ referrer: string | null; count: number }>,
  limit: number,
): { host: string | null; count: number }[] {
  const totals = new Map<string | null, number>();
  for (const row of rows) {
    const host = referrerHost(row.referrer);
    totals.set(host, (totals.get(host) ?? 0) + row.count);
  }
  return [...totals.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count || String(a.host).localeCompare(String(b.host)))
    .slice(0, limit);
}
