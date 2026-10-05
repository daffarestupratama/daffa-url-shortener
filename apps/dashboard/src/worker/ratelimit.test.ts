import { describe, expect, it } from 'vitest';
import { ipBucket } from './ratelimit';

// rateLimitSubject and the HMAC live in shared/ip.ts, tested in shared/ip.test.ts.

describe('ipBucket', () => {
  // Recorded before rateLimitSubject and the HMAC moved to shared/ip.ts, so the
  // move provably kept every bucket name the same.
  it('keeps the bucket names it had before the move to shared', async () => {
    expect(await ipBucket('secret', '203.0.113.7')).toBe('ip:0e2l-FQ2rS1eJYKLe8d8opDWx5epqyR5MnrsN_o-CdM');
    expect(await ipBucket('secret', '2001:db8:1:2::a')).toBe('ip:zX0q2UThjoXoIo5FtOCA3L_ZjmbRTJW7wl_fzNwOMbE');
  });

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
