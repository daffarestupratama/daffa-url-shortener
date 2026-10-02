import { describe, expect, it } from 'vitest';
import { ipBucket, rateLimitSubject } from './ratelimit';

describe('rateLimitSubject', () => {
  it('keeps an IPv4 address as it is', () => {
    expect(rateLimitSubject('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitSubject(' 203.0.113.7 ')).toBe('203.0.113.7');
  });

  it('reads an IPv4 mapped IPv6 address as IPv4', () => {
    expect(rateLimitSubject('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('reduces IPv6 to its /64, so hopping inside the block does not reset the limit', () => {
    const subject = '2001:db8:85a3:12::/64';
    expect(rateLimitSubject('2001:db8:85a3:12::1')).toBe(subject);
    expect(rateLimitSubject('2001:0DB8:85a3:0012:ffff:1:2:3')).toBe(subject);
    expect(rateLimitSubject('2001:db8:85a3:12:abcd::9%eth0')).toBe(subject);
    expect(rateLimitSubject('2001:db8:85a3:13::1')).not.toBe(subject);
  });

  it('expands :: at any position', () => {
    expect(rateLimitSubject('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitSubject('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(rateLimitSubject('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
  });

  it('puts a missing address into one shared bucket', () => {
    expect(rateLimitSubject(undefined)).toBe('unknown');
    expect(rateLimitSubject(null)).toBe('unknown');
    expect(rateLimitSubject('  ')).toBe('unknown');
  });

  it('keeps a value it cannot parse as it is rather than guessing', () => {
    expect(rateLimitSubject('1:2:3::4::5')).toBe('1:2:3::4::5');
  });
});

describe('ipBucket', () => {
  it('is deterministic for one secret and address', async () => {
    expect(await ipBucket('secret', '203.0.113.7')).toBe(await ipBucket('secret', '203.0.113.7'));
  });

  it('is an HMAC: base64url, without the address, and different per secret', async () => {
    const bucket = await ipBucket('secret', '203.0.113.7');
    expect(bucket).toMatch(/^ip:[A-Za-z0-9_-]{43}$/);
    expect(bucket).not.toContain('203');
    expect(await ipBucket('another secret', '203.0.113.7')).not.toBe(bucket);
    expect(await ipBucket('secret', '203.0.113.8')).not.toBe(bucket);
  });

  it('gives every address inside one IPv6 /64 the same bucket', async () => {
    expect(await ipBucket('secret', '2001:db8:1:2::a')).toBe(await ipBucket('secret', '2001:db8:1:2:ffff::b'));
  });
});
