/** Derived from is_active and expires_at, never stored. */
export type LinkStatus = 'active' | 'inactive' | 'expired';

/** A row of the links table, exactly as D1 returns it. */
export interface LinkRow {
  id: number;
  slug: string;
  url: string;
  title: string;
  description: string;
  is_active: number;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

/** A link as the API hands it to the client. */
export interface Link {
  id: number;
  slug: string;
  url: string;
  title: string;
  description: string;
  isActive: boolean;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  status: LinkStatus;
}

/** Everything the redirector records for one served redirect. */
export interface ClickInsert {
  linkId: number;
  ts: number;
  ip: string;
  ua: string;
  isBot: boolean;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  colo: string | null;
  asn: number | null;
  asOrg: string | null;
  referrer: string | null;
}

/** Time ranges offered by the analytics segmented control. */
export type Range = '24h' | '7d' | '30d' | '90d' | 'all';

export const RANGES: ReadonlyArray<readonly [Range, string]> = [
  ['24h', '24 hours'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['90d', '90 days'],
  ['all', 'All'],
];

export const RANGE_TEXT: Record<Range, string> = {
  '24h': 'in the last 24 hours',
  '7d': 'in the last 7 days',
  '30d': 'in the last 30 days',
  '90d': 'in the last 90 days',
  all: 'since the link was created',
};

/** Chart bucket size. Hours for 24h, WIB days for 7d to 90d, WIB months for all. */
export type Bucket = 'hour' | 'day' | 'month';

// Dashboard API contract. Every timestamp is epoch milliseconds, and the client
// converts to WIB for display.

export type LinkStatusFilter = 'all' | LinkStatus;
export type Visibility = 'private' | 'public';

/** Rows per page of the links list, on both tabs. */
export const LINK_LIST_PAGE_SIZE = 25;
export type LinkSort = 'newest' | 'oldest' | 'clicks' | 'least';

export type ErrorCode =
  | 'bad_request'
  | 'invalid_id'
  | 'invalid_json'
  | 'invalid_field'
  | 'invalid_url'
  | 'invalid_slug'
  | 'forbidden'
  | 'csrf_rejected'
  | 'not_found'
  | 'slug_taken'
  | 'payload_too_large'
  | 'internal'
  | 'auth_not_configured'
  | 'database_unavailable'
  | 'invalid_host'
  | 'blocked_domain'
  | 'turnstile_failed'
  | 'turnstile_unavailable'
  | 'rate_limited_ip'
  | 'rate_limited_global'
  | 'public_not_configured';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** On rate_limited_ip and rate_limited_global: when creation opens again, the next clock hour. */
    resetAt?: number;
    /** On invalid_url from the public endpoint: which rule of checkPublicUrl failed. */
    reason?: string;
  };
}

/** Body of POST /api/links and PATCH /api/links/:id. */
export interface LinkInput {
  url?: string;
  slug?: string;
  title?: string;
  description?: string;
  tags?: string[];
  expiresAt?: number | null;
  isActive?: boolean;
}

export interface LinkListItem extends Link {
  /** Human clicks in the 7 day WIB window. */
  clicks7d: number;
}

/** A public link as the owner sees it on the Public tab. Counters only, no analytics. */
export interface PublicLinkItem {
  id: number;
  slug: string;
  url: string;
  /** Hostname without www, which is also the stored title. */
  host: string;
  isActive: boolean;
  /** Public links never expire, so only active or inactive. */
  status: LinkStatus;
  createdAt: number;
  updatedAt: number;
  clickTotal: number;
  /** Clicks in the current UTC day, against PUBLIC_DAILY_CLICK_LIMIT. */
  clicksToday: number;
  limitReached: boolean;
  /** The host falls under an entry of the blocked domains list. */
  domainBlocked: boolean;
}

export interface VisibilityCount {
  /** Links of this visibility that match the current filters. */
  matching: number;
  /** Every link of this visibility. Zero means the empty state. */
  total: number;
}

export interface LinkListBase {
  /** Pass back as ?cursor= for the next page. Null on the last page. */
  nextCursor: string | null;
  /** For the tab labels. The tag filter only narrows private links. */
  counts: Record<Visibility, VisibilityCount>;
}

export interface PrivateLinkList extends LinkListBase {
  visibility: 'private';
  links: LinkListItem[];
}

export interface PublicLinkList extends LinkListBase {
  visibility: 'public';
  links: PublicLinkItem[];
}

export type LinkList = PrivateLinkList | PublicLinkList;

export interface LinkDetail {
  link: Link;
  /** All time totals, shown in the delete confirmation. */
  totals: { human: number; bot: number };
}

export interface Summary {
  total: number;
  active: number;
  human7d: number;
  unique7d: number;
  top: { id: number; slug: string; title: string; clicks: number } | null;
  windowStart: number;
  windowEnd: number;
  /** Every public link, any status. total and active above count private links only. */
  publicTotal: number;
  /** Clicks of all public links in the current UTC day. */
  publicClicksToday: number;
  /** PUBLIC_DAILY_CLICK_BUDGET, for the progress bar. */
  publicDailyBudget: number;
}

/** Body of POST /api/public/links. */
export interface PublicCreateInput {
  url: string;
  /** A slug from randomPublicSlug. Left out, the server picks one. */
  slug?: string;
  turnstileToken: string;
}

/** Everything the public result card needs, and nothing else. */
export interface PublicCreateResult {
  /** May differ from the requested slug when that one was taken meanwhile. */
  slug: string;
  shortUrl: string;
  /** The destination as stored, after normalization. */
  url: string;
  createdAt: number;
}

export interface BlockedDomain {
  host: string;
  createdAt: number;
}

export interface BlockedDomainList {
  domains: BlockedDomain[];
  /** Every blocked domain, ignoring the search. */
  total: number;
}

/** For the block dialog: whether a host is covered already, and how many links it would disable. */
export interface BlockedDomainCheck {
  host: string;
  /** The entry that already covers the host, itself or a parent domain. */
  blockedBy: string | null;
  activePublicLinks: number;
}

export interface BlockDomainResult {
  domain: BlockedDomain;
  /** False when the host was on the list already. */
  created: boolean;
  /** Active public links disabled by this request. */
  disabled: number;
}

export interface SlugAvailability {
  slug: string;
  available: boolean;
  code?: 'invalid_slug' | 'slug_taken';
  message?: string;
}

export interface SeriesPoint {
  start: number;
  human: number;
  unique: number;
  bot: number;
}

export interface Analytics {
  range: Range;
  bucket: Bucket;
  start: number;
  end: number;
  totals: { human: number; unique: number; bot: number };
  allTime: { human: number; lastHumanAt: number | null };
  series: SeriesPoint[];
  countries: { country: string | null; count: number }[];
  cities: { city: string | null; country: string | null; count: number }[];
  /** Hostname without www, or null for direct visits. */
  referrers: { host: string | null; count: number }[];
  colos: { colo: string | null; count: number }[];
  asns: { asn: number | null; org: string | null; count: number }[];
  /** Raw user agents with counts. Device, browser, OS and bot names are parsed in the browser. */
  userAgents: {
    human: { ua: string; count: number }[];
    bot: { ua: string; count: number }[];
  };
}

export interface ClickRow {
  id: number;
  ts: number;
  ip: string;
  ua: string;
  isBot: boolean;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  colo: string | null;
  asn: number | null;
  asOrg: string | null;
  referrer: string | null;
}

export interface ClickLogPage {
  rows: ClickRow[];
  total: number;
  page: number;
  pageSize: number;
}
