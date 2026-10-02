import { describe, expect, it } from 'vitest';
import { blockedDomainMessage, checkPublicUrl, hostOf, hostPath, validateUrl } from './url';

const INVALID_FORMAT = 'Invalid URL format. Use a full address starting with https://';
const REDIRECT_LOOP =
  'Destination URL cannot point to daffa.me because it would create a redirect loop.';

describe('validateUrl', () => {
  it('accepts full http and https addresses', () => {
    expect(validateUrl('https://www.linkedin.com/in/daffarestupratama')).toBeNull();
    expect(validateUrl('http://example.com/a/b?c=d#e')).toBeNull();
    expect(validateUrl('  https://example.com  ')).toBeNull();
  });

  it('stays quiet on an empty value unless the caller asks', () => {
    expect(validateUrl('')).toBeNull();
    expect(validateUrl('   ')).toBeNull();
    expect(validateUrl('', { required: true })).toBe('Destination URL is required.');
  });

  it('rejects anything that is not a full http address', () => {
    expect(validateUrl('example.com')).toBe(INVALID_FORMAT);
    expect(validateUrl('not a url')).toBe(INVALID_FORMAT);
    expect(validateUrl('ftp://example.com')).toBe(INVALID_FORMAT);
    expect(validateUrl('javascript:alert(1)')).toBe(INVALID_FORMAT);
    expect(validateUrl('https://localhost')).toBe(INVALID_FORMAT);
  });

  it('blocks only the hosts that would loop back into the redirector', () => {
    expect(validateUrl('https://daffa.me/cv')).toBe(REDIRECT_LOOP);
    expect(validateUrl('https://www.daffa.me/cv')).toBe(REDIRECT_LOOP);
    expect(validateUrl('http://DAFFA.ME/cv')).toBe(REDIRECT_LOOP);
  });

  it('allows every other daffa.me subdomain', () => {
    expect(validateUrl('https://shorten.daffa.me')).toBeNull();
    expect(validateUrl('https://foo.daffa.me/page')).toBeNull();
    expect(validateUrl('https://blog.daffa.me')).toBeNull();
    expect(validateUrl('https://notdaffa.me')).toBeNull();
  });
});

describe('hostPath', () => {
  it('strips the scheme and a leading www', () => {
    expect(hostPath('https://www.linkedin.com/in/daffarestupratama')).toBe(
      'linkedin.com/in/daffarestupratama',
    );
    expect(hostPath('http://example.com/a')).toBe('example.com/a');
    expect(hostPath('https://wa.me/6281234567890?text=Halo')).toBe(
      'wa.me/6281234567890?text=Halo',
    );
  });
});

describe('hostOf', () => {
  it('returns the host on its own for the title fallback', () => {
    expect(hostOf('https://www.kaggle.com/daffarestupratama')).toBe('kaggle.com');
    expect(hostOf('  https://github.com/daffarestupratama  ')).toBe('github.com');
  });
});

describe('checkPublicUrl', () => {
  const code = (value: string) => checkPublicUrl(value)?.code ?? null;

  it('accepts ordinary destinations', () => {
    expect(checkPublicUrl('https://docs.google.com/forms/d/e/1FAIpQLSd3kR9vQx/viewform')).toBeNull();
    expect(checkPublicUrl('  http://example.com/a?b=c  ')).toBeNull();
    expect(checkPublicUrl('https://xn--bcher-kva.de/')).toBeNull();
    expect(checkPublicUrl('https://bücher.de/')).toBeNull();
    expect(checkPublicUrl('https://notdaffa.me')).toBeNull();
    expect(checkPublicUrl('https://youtu.be/Qm7kL2xTn4E')).toBeNull();
  });

  it('requires a value', () => {
    expect(checkPublicUrl('   ')).toEqual({
      code: 'required',
      message: 'Destination URL is required.',
    });
  });

  it('allows 2048 characters and rejects 2049', () => {
    const base = 'https://example.com/';
    expect(code(base + 'a'.repeat(2048 - base.length))).toBeNull();
    expect(code(base + 'a'.repeat(2049 - base.length))).toBe('too_long');
    expect(checkPublicUrl(base + 'a'.repeat(3000))?.message).toBe(
      'Destination URL must be 2048 characters or fewer.',
    );
  });

  it('applies the owner format rules with the public copy', () => {
    for (const value of ['example.com', 'not a url', 'ftp://example.com', 'javascript:alert(1)', 'https://localhost']) {
      expect(code(value), value).toBe('invalid');
    }
    expect(checkPublicUrl('docs google com/forms/rsvp')?.message).toBe(
      'Invalid URL format. Use a full address that starts with https://',
    );
  });

  it('refuses daffa.me and every subdomain of it', () => {
    for (const value of ['https://daffa.me/cv', 'https://www.daffa.me', 'https://s.daffa.me/x', 'https://link.daffa.me', 'https://shorten.daffa.me', 'http://DAFFA.ME.']) {
      expect(code(value), value).toBe('loop');
    }
  });

  it('refuses IP addresses in any notation', () => {
    for (const value of ['http://127.0.0.1/', 'https://203.0.113.9/x', 'http://2130706433/', 'http://0x7f.1/', 'http://[::1]/', 'http://[2001:db8::1]/']) {
      expect(code(value), value).toBe('ip');
    }
  });

  it('refuses other shorteners and names the host without www', () => {
    expect(code('https://bit.ly/3xYz9Qa')).toBe('shortener');
    expect(code('https://sub.s.id/abc')).toBe('shortener');
    expect(code('https://TinyURL.com/abc')).toBe('shortener');
    expect(checkPublicUrl('https://www.bit.ly/3xYz9Qa?x=1')?.message).toBe(
      'Links from other URL shorteners such as bit.ly are not accepted. Use the final destination address instead.',
    );
  });

  it('leaves the owner rules untouched', () => {
    expect(validateUrl('https://shorten.daffa.me')).toBeNull();
    expect(validateUrl('https://bit.ly/3xYz9Qa')).toBeNull();
    expect(validateUrl('http://127.0.0.1/')).toBeNull();
  });
});

describe('blockedDomainMessage', () => {
  it('names the blocked host', () => {
    expect(blockedDomainMessage('login-verif-bca.site')).toBe(
      'The domain login-verif-bca.site is blocked for public links and cannot be shortened.',
    );
  });
});
