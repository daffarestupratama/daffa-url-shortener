import type { LinkStatus } from './types';

export const STATUS_META: Record<LinkStatus, { label: string; token: string }> = {
  active: { label: 'ACTIVE', token: '--ok' },
  inactive: { label: 'INACTIVE', token: '--off' },
  expired: { label: 'EXPIRED', token: '--exp' },
};

/**
 * An expiry date in the past wins over the active switch, matching the design.
 * A link is only served by the redirector when this returns 'active'.
 */
export function deriveStatus(
  isActive: boolean,
  expiresAt: number | null,
  now: number = Date.now(),
): LinkStatus {
  if (expiresAt !== null && expiresAt < now) return 'expired';
  return isActive ? 'active' : 'inactive';
}

export function isServable(
  isActive: boolean,
  expiresAt: number | null,
  now: number = Date.now(),
): boolean {
  return deriveStatus(isActive, expiresAt, now) === 'active';
}
