import { describe, expect, it } from 'vitest';
import {
  GENERATED_SLUG_LENGTH,
  RESERVED,
  SLUG_ALPHABET,
  SLUG_RE,
  generateSlug,
  isValidSlugPath,
  normalizeSlugPath,
  validateSlug,
} from './slug';

describe('validateSlug', () => {
  it('accepts a plain slug', () => {
    expect(validateSlug('cv')).toBeNull();
    expect(validateSlug('porto-2026')).toBeNull();
    expect(validateSlug('k7m2qx')).toBeNull();
  });

  it('stays quiet on an empty slug unless the caller asks', () => {
    expect(validateSlug('')).toBeNull();
    expect(validateSlug('', { required: true })).toBe(
      'Slug is required. Press Generate to fill in a random slug.',
    );
  });

  it('rejects a leading hyphen', () => {
    expect(validateSlug('-cv')).toBe('Slug cannot start with a hyphen.');
  });

  it('rejects uppercase before complaining about the character set', () => {
    expect(validateSlug('CV')).toBe(
      'Slug must be lowercase. Replace uppercase letters with lowercase.',
    );
  });

  it('rejects characters outside lowercase letters, digits and hyphens', () => {
    expect(validateSlug('my slug')).toBe(
      'Slug may only contain lowercase letters, numbers, and hyphens.',
    );
    expect(validateSlug('café')).toBe(
      'Slug may only contain lowercase letters, numbers, and hyphens.',
    );
    expect(validateSlug('a_b')).toBe(
      'Slug may only contain lowercase letters, numbers, and hyphens.',
    );
  });

  it('enforces the length bounds', () => {
    expect(validateSlug('a')).toBe('Slug must be at least 2 characters.');
    expect(validateSlug('ab')).toBeNull();
    expect(validateSlug('a'.repeat(80))).toBeNull();
    expect(validateSlug('a'.repeat(81))).toBe('Slug must be 80 characters or fewer.');
  });

  it('rejects every reserved word', () => {
    for (const word of RESERVED) {
      expect(validateSlug(word)).toBe(`"${word}" is a reserved word and cannot be used.`);
    }
  });

  it('reports a conflict with the owning link title', () => {
    const taken = [{ slug: 'cv', title: 'CV and LinkedIn profile' }];
    expect(validateSlug('cv', { taken })).toBe(
      'This slug is already used by "CV and LinkedIn profile".',
    );
    expect(validateSlug('gh', { taken })).toBeNull();
  });
});

describe('SLUG_RE and isValidSlugPath', () => {
  it('matches what validateSlug accepts', () => {
    for (const good of ['cv', 'ab', 'porto-2026', 'k7m2qx', '2026', 'a'.repeat(80)]) {
      expect(SLUG_RE.test(good), good).toBe(true);
    }
    for (const bad of ['', 'a', '-cv', 'CV', 'my slug', 'a/b', 'a'.repeat(81), 'a.b']) {
      expect(SLUG_RE.test(bad), bad).toBe(false);
    }
  });

  it('rejects a nested path so the redirector never queries D1 for it', () => {
    expect(isValidSlugPath('a/b')).toBe(false);
    expect(isValidSlugPath('favicon.ico')).toBe(false);
  });
});

describe('normalizeSlugPath', () => {
  it('lowercases and drops one trailing slash', () => {
    expect(normalizeSlugPath('/cv')).toBe('cv');
    expect(normalizeSlugPath('/CV')).toBe('cv');
    expect(normalizeSlugPath('/CV/')).toBe('cv');
    expect(normalizeSlugPath('/Porto-2026/')).toBe('porto-2026');
  });

  it('leaves nothing valid behind for the root or a bare slash', () => {
    expect(isValidSlugPath(normalizeSlugPath('/'))).toBe(false);
    expect(isValidSlugPath(normalizeSlugPath('//'))).toBe(false);
  });
});

describe('generateSlug', () => {
  it('produces six characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const slug = generateSlug();
      expect(slug).toMatch(/^[abcdefghijkmnpqrstuvwxyz23456789]{6}$/);
      expect(slug).toHaveLength(6);
      expect(validateSlug(slug)).toBeNull();
    }
  });

  it('retries until it finds an unused slug', () => {
    const seen: string[] = [];
    const slug = generateSlug((candidate) => {
      if (seen.length < 3) {
        seen.push(candidate);
        return true;
      }
      return false;
    });
    expect(seen).toHaveLength(3);
    expect(seen).not.toContain(slug);
  });

  it('gives up rather than looping forever', () => {
    expect(() => generateSlug(() => true, 5)).toThrow('Unable to generate an unused slug.');
  });
});

describe('SLUG_ALPHABET', () => {
  it('holds 32 unambiguous characters and generated slugs use only those', () => {
    expect(SLUG_ALPHABET).toHaveLength(32);
    expect(SLUG_ALPHABET).not.toMatch(/[lo01]/);
    const slug = generateSlug();
    expect(slug).toHaveLength(GENERATED_SLUG_LENGTH);
    expect([...slug].every((char) => SLUG_ALPHABET.includes(char))).toBe(true);
  });
});
