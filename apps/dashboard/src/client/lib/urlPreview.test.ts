import { describe, expect, it } from 'vitest';
import { urlPreview } from './urlPreview';

describe('urlPreview', () => {
  it('shows the address when https is added', () => {
    expect(urlPreview('example.com/page')).toBe('https://example.com/page');
  });

  it('shows the address when the scheme is lowercased', () => {
    expect(urlPreview('HTTPS://Example.com/A')).toBe('https://Example.com/A');
  });

  it('shows a protocol relative address with https', () => {
    expect(urlPreview('//example.com')).toBe('https://example.com');
  });

  it('hides an address that is already normalized', () => {
    expect(urlPreview('https://example.com/page')).toBeNull();
    expect(urlPreview('http://example.com')).toBeNull();
  });

  it('ignores surrounding whitespace alone', () => {
    expect(urlPreview('  https://example.com  ')).toBeNull();
  });

  it('still shows a real change inside surrounding whitespace', () => {
    expect(urlPreview('  example.com ')).toBe('https://example.com');
  });

  it('hides an empty or blank field', () => {
    expect(urlPreview('')).toBeNull();
    expect(urlPreview('   ')).toBeNull();
  });
});
