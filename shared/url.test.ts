import { describe, expect, it } from 'vitest';
import {
  INVALID_URL_FORMAT,
  blockedDomainMessage,
  checkPublicUrl,
  hostOf,
  hostPath,
  normalizeUrlInput,
  validateUrl,
} from './url';

const INVALID_FORMAT =
  'Invalid URL format. Enter a web address such as example.com or https://example.com/page.';
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

  it('accepts a bare domain, which gains https://', () => {
    expect(validateUrl('example.com')).toBeNull();
    expect(validateUrl('www.example.com/a?b=c')).toBeNull();
  });

  it('rejects anything that is not a web address', () => {
    expect(validateUrl('not a url')).toBe(INVALID_FORMAT);
    expect(validateUrl('localhost:3000')).toBe(INVALID_FORMAT);
    expect(validateUrl('data:text/html,x')).toBe(INVALID_FORMAT);
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
    for (const value of ['not a url', 'ftp://example.com', 'javascript:alert(1)', 'data:text/html,x', 'https://localhost', 'localhost:3000']) {
      expect(code(value), value).toBe('invalid');
    }
    expect(checkPublicUrl('docs google com/forms/rsvp')?.message).toBe(INVALID_FORMAT);
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

describe('normalizeUrlInput', () => {
  it('adds https:// to an address typed without a scheme', () => {
    expect(normalizeUrlInput('example.com/path')).toBe('https://example.com/path');
    expect(normalizeUrlInput('www.example.com')).toBe('https://www.example.com');
    expect(normalizeUrlInput('example.com:8080/x')).toBe('https://example.com:8080/x');
    expect(normalizeUrlInput('//example.com/a')).toBe('https://example.com/a');
  });

  it('keeps an explicit http:// or https:// as typed', () => {
    expect(normalizeUrlInput('http://example.com/A?b=C')).toBe('http://example.com/A?b=C');
    expect(normalizeUrlInput('https://Example.com/Path')).toBe('https://Example.com/Path');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeUrlInput('  \n example.com/x \t ')).toBe('https://example.com/x');
    expect(normalizeUrlInput('   ')).toBe('');
  });

  it('recognizes an uppercase scheme and lowercases only the scheme', () => {
    expect(normalizeUrlInput('HTTPS://Example.com/A')).toBe('https://Example.com/A');
    expect(normalizeUrlInput('Http://example.com')).toBe('http://example.com');
    expect(validateUrl('HTTPS://EXAMPLE.COM/A')).toBeNull();
  });

  it('leaves other schemes alone so the validators reject them', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@example.com', 'ftp://example.com']) {
      expect(normalizeUrlInput(value), value).toBe(value);
      expect(validateUrl(value), value).toBe(INVALID_URL_FORMAT);
      expect(checkPublicUrl(value)?.code, value).toBe('invalid');
    }
  });

  it('treats host:port as an address, so the dotted host rule still decides', () => {
    expect(normalizeUrlInput('localhost:3000')).toBe('https://localhost:3000');
    expect(validateUrl('localhost:3000')).toBe(INVALID_URL_FORMAT);
    expect(checkPublicUrl('localhost:3000')?.code).toBe('invalid');
    expect(validateUrl('javascript:0')).toBe(INVALID_URL_FORMAT);
  });

  it('changes nothing when applied twice', () => {
    for (const value of ['example.com/x', 'HTTP://a.com', '//a.com', 'javascript:alert(1)', 'localhost:3000', '  b.com  ']) {
      const once = normalizeUrlInput(value);
      expect(normalizeUrlInput(once), value).toBe(once);
    }
  });

  it('measures the length after the prefix is added', () => {
    const bare = `example.com/${'a'.repeat(2040 - 'example.com/'.length)}`;
    expect(bare.length).toBe(2040);
    expect(normalizeUrlInput(bare).length).toBe(2048);
    expect(checkPublicUrl(bare)).toBeNull();
    const over = `${bare}xyz`;
    expect(over.length).toBeLessThanOrEqual(2048);
    expect(checkPublicUrl(over)?.code).toBe('too_long');
  });

  it('reports a bare IP address as an IP, not as a format error', () => {
    expect(checkPublicUrl('192.168.1.1')?.code).toBe('ip');
  });
});

describe('blockedDomainMessage', () => {
  it('names the blocked host', () => {
    expect(blockedDomainMessage('login-verif-bca.site')).toBe(
      'The domain login-verif-bca.site is blocked for public links and cannot be shortened.',
    );
  });
});
