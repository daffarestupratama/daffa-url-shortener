import { hmacTag, rateLimitSubject } from '@daffa/shared';

/**
 * Buckets for the hourly public creation limits. Rows in rate_limits are keyed
 * by bucket and clock hour: one shared 'global' bucket, and one per visitor
 * named 'ip:' plus an HMAC-SHA-256 of the visitor's subject (shared/ip.ts:
 * the IPv4 address, or the IPv6 /64). The secret keeps the stored value from
 * being reversed by hashing every IPv4 address, and no raw address is ever
 * written.
 */

export const GLOBAL_BUCKET = 'global';

/** The per visitor bucket name for a CF-Connecting-IP value. */
export async function ipBucket(secret: string, ip: string | null | undefined): Promise<string> {
  return `ip:${await hmacTag(secret, rateLimitSubject(ip))}`;
}
