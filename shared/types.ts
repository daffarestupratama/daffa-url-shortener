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
