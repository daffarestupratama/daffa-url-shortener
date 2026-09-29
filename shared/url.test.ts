import { describe, expect, it } from 'vitest';
import { hostOf, hostPath, validateUrl } from './url';

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
