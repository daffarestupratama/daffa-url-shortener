import { describe, expect, it } from 'vitest';
import { candidateParams, coveringEntry, linksOnDomain, suffixesJson, urlHostname } from './hosts';

describe('urlHostname', () => {
  it('lowercases and drops a trailing dot', () => {
    expect(urlHostname('https://WWW.Example.COM./a')).toBe('www.example.com');
    expect(urlHostname('not a url')).toBeNull();
  });
});

describe('blocking by domain', () => {
  const links = [
    { id: 1, url: 'https://example.com/a' },
    { id: 2, url: 'https://www.example.com/b' },
    { id: 3, url: 'https://shop.example.com/c' },
    { id: 4, url: 'https://notexample.com/d' },
    { id: 5, url: 'https://a.www.example.com/e' },
  ];
  const ids = (host: string) => linksOnDomain(links, host).map((link) => link.id);

  it('covers the domain and every subdomain, never a lookalike', () => {
    expect(ids('example.com')).toEqual([1, 2, 3, 5]);
    expect(ids('shop.example.com')).toEqual([3]);
  });

  it('settles a www host exactly, though the titles cannot tell the links apart', () => {
    // Links 1 and 2 share the title example.com. Only link 2 is on www.example.com.
    expect(ids('www.example.com')).toEqual([2, 5]);
  });

  it('searches titles by the host without www and by subdomain', () => {
    expect(candidateParams('example.com')).toEqual(['example.com', '%.example.com']);
    expect(candidateParams('www.example.com')).toEqual(['example.com', '%.www.example.com']);
  });

  it('collects every suffix of every host once for a single lookup', () => {
    expect(JSON.parse(suffixesJson(['a.example.com', 'b.example.com']))).toEqual([
      'a.example.com',
      'example.com',
      'com',
      'b.example.com',
    ]);
  });

  it('reports the widest blocked entry covering a host', () => {
    const blocked = new Set(['example.com', 'shop.example.com']);
    expect(coveringEntry('a.shop.example.com', blocked)).toBe('example.com');
    expect(coveringEntry('notexample.com', blocked)).toBeNull();
  });
});
