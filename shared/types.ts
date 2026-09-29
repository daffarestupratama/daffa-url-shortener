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
export type LinkSort = 'newest' | 'clicks';

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
  | 'database_unavailable';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
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

export interface LinkList {
  links: LinkListItem[];
  /** Every saved link, ignoring filters. Zero means the empty state. */
  total: number;
}

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
