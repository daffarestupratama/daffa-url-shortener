import { describe, expect, it, vi } from 'vitest';
import { TEST_SECRET_HOSTNAME, acceptedHostnames, verifyTurnstile } from './turnstile';

const answer = (body: object) => vi.fn(async () => Response.json(body)) as unknown as typeof fetch;

describe('acceptedHostnames', () => {
  it('is exactly link.daffa.me in production', () => {
    expect(acceptedHostnames(false)).toEqual(['link.daffa.me']);
  });

  it('adds the test secret hostname and localhost only under the local bypass', () => {
    expect(acceptedHostnames(true)).toEqual(['localhost', TEST_SECRET_HOSTNAME]);
    expect(TEST_SECRET_HOSTNAME).toBe('example.com');
  });
});

describe('verifyTurnstile', () => {
  const base = { secret: 's', token: 't', devBypass: false };

  it('passes only a successful answer from an accepted hostname', async () => {
    expect(await verifyTurnstile({ ...base, fetcher: answer({ success: true, hostname: 'link.daffa.me' }) })).toBe('ok');
    expect(await verifyTurnstile({ ...base, fetcher: answer({ success: true, hostname: 'example.com' }) })).toBe('failed');
    expect(
      await verifyTurnstile({ ...base, devBypass: true, fetcher: answer({ success: true, hostname: 'example.com' }) }),
    ).toBe('ok');
  });

  it('reads the always fail answer as failed', async () => {
    const fetcher = answer({ success: false, 'error-codes': ['invalid-input-response'] });
    expect(await verifyTurnstile({ ...base, fetcher })).toBe('failed');
  });

  it('treats a string "true" as no success', async () => {
    expect(await verifyTurnstile({ ...base, fetcher: answer({ success: 'true', hostname: 'link.daffa.me' }) })).toBe(
      'failed',
    );
  });

  it('leaves out remoteip when the address is unknown', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ success: true, hostname: 'link.daffa.me' }));
    await verifyTurnstile({ ...base, remoteIp: null, fetcher: fetcher as unknown as typeof fetch });
    const body = new URLSearchParams(String(fetcher.mock.calls[0]?.[1].body));
    expect(body.has('remoteip')).toBe(false);
    expect(fetcher.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });
});
