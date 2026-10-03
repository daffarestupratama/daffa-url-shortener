import { describe, expect, it } from 'vitest';
import { urlPreview } from './urlPreview';

describe('urlPreview', () => {
  it('shows the address when https is added', () => {
    expect(urlPreview('example.com/page')).toBe('https://example.com/page');
  });

  it('shows the canonical address when the scheme or host was uppercase', () => {
    expect(urlPreview('HTTPS://Example.com/A')).toBe('https://example.com/A');
    expect(urlPreview('https://EXAMPLE.com/a')).toBe('https://example.com/a');
  });

  it('repairs a scheme typed without its slashes', () => {
    expect(urlPreview('http:example.com/coba-satu')).toBe('http://example.com/coba-satu');
    expect(urlPreview('https:/example.com/x')).toBe('https://example.com/x');
  });

  it('shows a protocol relative address with https', () => {
    expect(urlPreview('//example.com')).toBe('https://example.com');
  });

  it('hides an address that is already canonical', () => {
    expect(urlPreview('https://example.com/page')).toBeNull();
    expect(urlPreview('http://example.com/')).toBeNull();
  });

  it('never shows only the slash after a bare host', () => {
    expect(urlPreview('https://example.com')).toBeNull();
    expect(urlPreview('http://example.com')).toBeNull();
    expect(urlPreview('example.com')).toBe('https://example.com');
  });

  it('keeps the slash after a host with a query', () => {
    expect(urlPreview('https://example.com?a=1')).toBe('https://example.com/?a=1');
  });

  it('ignores surrounding whitespace alone', () => {
    expect(urlPreview('  https://example.com/a  ')).toBeNull();
  });

  it('still shows a real change inside surrounding whitespace', () => {
    expect(urlPreview('  example.com ')).toBe('https://example.com');
  });

  it('hides an empty or blank field', () => {
    expect(urlPreview('')).toBeNull();
    expect(urlPreview('   ')).toBeNull();
  });
});
