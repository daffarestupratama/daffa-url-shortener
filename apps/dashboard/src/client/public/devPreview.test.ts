import { blockedDomainMessage, checkPublicUrl, INVALID_URL_FORMAT } from '@daffa/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { publicPreview } from './devPreview';

// The module announces the first preview it sees on the console.
beforeAll(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

const NOW = Date.UTC(2026, 9, 3, 7, 32, 12);
const NEXT_HOUR = Date.UTC(2026, 9, 3, 8);

describe('publicPreview', () => {
  it('is off without parameters, so the form works normally', () => {
    expect(publicPreview('', NOW)).toBeNull();
    expect(publicPreview('?utm_source=x', NOW)).toBeNull();
  });

  it('is on for every state and overlay, which stops the form from submitting', () => {
    const states = [
      'filled', 'submitting', 'success', 'invalid', 'ip', 'too-long', 'loop', 'shortener', 'blocked',
      'turnstile', 'turnstile-pending', 'turnstile-offline', 'network', 'unavailable', 'static-hero',
    ];
    for (const state of states) expect(publicPreview(`?state=${state}`, NOW), state).not.toBeNull();
    for (const overlay of ['rate-visitor', 'rate-global', 'toast']) {
      expect(publicPreview(`?overlay=${overlay}`, NOW), overlay).not.toBeNull();
    }
  });

  it('shows the same field messages the local check and the server give', () => {
    expect(publicPreview('?state=invalid', NOW)?.form?.fieldError).toBe(INVALID_URL_FORMAT);
    for (const [state, code] of [['ip', 'ip'], ['too-long', 'too_long'], ['loop', 'loop'], ['shortener', 'shortener']] as const) {
      const form = publicPreview(`?state=${state}`, NOW)?.form;
      expect(checkPublicUrl(form?.url ?? '')?.code, state).toBe(code);
      expect(form?.fieldError, state).toBe(checkPublicUrl(form?.url ?? '')?.message);
    }
    expect(publicPreview('?state=blocked', NOW)?.form?.fieldError).toBe(blockedDomainMessage('login-verif-bca.site'));
  });

  it('forces the Turnstile slot without loading the live widget', () => {
    for (const [state, error] of [['turnstile', 'failed'], ['turnstile-pending', 'pending'], ['turnstile-offline', 'offline']] as const) {
      const preview = publicPreview(`?state=${state}`, NOW);
      expect(preview?.form?.turnstileError, state).toBe(error);
      expect(preview?.loadTurnstile, state).toBe(false);
    }
    expect(publicPreview('?state=filled', NOW)?.loadTurnstile).toBe(true);
  });

  it('counts the rate dialogs down to the next clock hour', () => {
    expect(publicPreview('?overlay=rate-visitor', NOW)?.rate).toEqual({ scope: 'visitor', resetAt: NEXT_HOUR });
    expect(publicPreview('?overlay=rate-global', NOW)?.rate).toEqual({ scope: 'global', resetAt: NEXT_HOUR });
  });

  it('combines a state with an overlay', () => {
    const preview = publicPreview('?state=success&overlay=toast', NOW);
    expect(preview?.result?.slug).toBe('x7kq2m');
    expect(preview?.toast).toBe('daffa.me/x7kq2m copied to clipboard');
  });
});
