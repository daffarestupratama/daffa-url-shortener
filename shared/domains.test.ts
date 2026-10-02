import { describe, expect, it } from 'vitest';
import {
  SHORTENER_HOSTS,
  hostSuffixes,
  isIpLiteral,
  isOnDomain,
  matchDomain,
  normalizeHost,
} from './domains';

describe('isOnDomain', () => {
  it('matches the domain itself and every subdomain', () => {
    expect(isOnDomain('example.com', 'example.com')).toBe(true);
    expect(isOnDomain('www.example.com', 'example.com')).toBe(true);
    expect(isOnDomain('a.b.example.com', 'example.com')).toBe(true);
  });

  it('never matches a different name that merely ends the same way', () => {
    expect(isOnDomain('notexample.com', 'example.com')).toBe(false);
    expect(isOnDomain('example.com.evil.net', 'example.com')).toBe(false);
    expect(isOnDomain('com', 'example.com')).toBe(false);
  });
});

describe('matchDomain', () => {
  it('returns the entry that matched, or null', () => {
    const list = ['grabgift-promo.com', 'freebet88.net'];
    expect(matchDomain('www.grabgift-promo.com', list)).toBe('grabgift-promo.com');
    expect(matchDomain('freebet88.net', list)).toBe('freebet88.net');
    expect(matchDomain('example.com', list)).toBeNull();
    expect(matchDomain('example.com', [])).toBeNull();
  });

  it('covers the shorteners from the design and their subdomains', () => {
    for (const host of ['bit.ly', 'www.bit.ly', 's.id', 'sub.s.id', 't.co', 'tinyurl.com']) {
      expect(matchDomain(host, SHORTENER_HOSTS), host).not.toBeNull();
    }
    expect(matchDomain('docs.google.com', SHORTENER_HOSTS)).toBeNull();
    expect(matchDomain('pass.id', SHORTENER_HOSTS)).toBeNull();
  });
});

describe('hostSuffixes', () => {
  it('lists every domain a host falls under, longest first', () => {
    expect(hostSuffixes('a.b.example.com')).toEqual([
      'a.b.example.com',
      'b.example.com',
      'example.com',
      'com',
    ]);
    expect(hostSuffixes('example.com')).toEqual(['example.com', 'com']);
  });

  it('agrees with matchDomain for any blocked entry', () => {
    const host = 'x.login.verif-bca.site';
    for (const blocked of ['verif-bca.site', 'login.verif-bca.site']) {
      expect(hostSuffixes(host)).toContain(blocked);
      expect(matchDomain(host, [blocked])).toBe(blocked);
    }
  });
});

describe('isIpLiteral', () => {
  it('flags IPv4 and bracketed IPv6 hostnames', () => {
    expect(isIpLiteral('127.0.0.1')).toBe(true);
    expect(isIpLiteral('203.0.113.9')).toBe(true);
    expect(isIpLiteral('[::1]')).toBe(true);
  });

  it('leaves names alone, including ones made of digits', () => {
    expect(isIpLiteral('example.com')).toBe(false);
    expect(isIpLiteral('123.example.com')).toBe(false);
    expect(isIpLiteral('1.2.3.com')).toBe(false);
  });

  it('works on what the URL parser produces from unusual IPv4 forms', () => {
    expect(isIpLiteral(new URL('http://2130706433/').hostname)).toBe(true);
    expect(isIpLiteral(new URL('http://0x7f.1/').hostname)).toBe(true);
  });
});

describe('normalizeHost', () => {
  it('lowercases and drops a trailing dot', () => {
    expect(normalizeHost('Example.COM.')).toBe('example.com');
    expect(normalizeHost('  grabgift-promo.com ')).toBe('grabgift-promo.com');
  });

  it('accepts a full URL and keeps only the hostname', () => {
    expect(normalizeHost('https://www.example.com/path?q=1')).toBe('www.example.com');
  });

  it('converts internationalized names to punycode', () => {
    expect(normalizeHost('bücher.de')).toBe('xn--bcher-kva.de');
  });

  it('rejects input that is not a dotted hostname', () => {
    expect(normalizeHost('')).toBeNull();
    expect(normalizeHost('localhost')).toBeNull();
    expect(normalizeHost('127.0.0.1')).toBeNull();
    expect(normalizeHost('[::1]')).toBeNull();
    expect(normalizeHost('exa mple.com')).toBeNull();
    expect(normalizeHost('-bad.com')).toBeNull();
  });
});
