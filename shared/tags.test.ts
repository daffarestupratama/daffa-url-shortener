import { describe, expect, it } from 'vitest';
import { addTag, normalizeTag, normalizeTags } from './tags';

describe('normalizeTag', () => {
  it('trims, lowercases and drops a leading hash', () => {
    expect(normalizeTag('  Career ')).toBe('career');
    expect(normalizeTag('#Portfolio')).toBe('portfolio');
  });

  it('folds runs of commas and whitespace into a single hyphen', () => {
    expect(normalizeTag('data science')).toBe('data-science');
    expect(normalizeTag('a,  b')).toBe('a-b');
    expect(normalizeTag('a\t\tb')).toBe('a-b');
  });

  it('returns an empty string for nothing usable', () => {
    expect(normalizeTag('')).toBe('');
    expect(normalizeTag('   ')).toBe('');
    expect(normalizeTag('#')).toBe('');
  });
});

describe('addTag', () => {
  it('appends a normalized tag', () => {
    expect(addTag(['career'], '#Portfolio')).toEqual(['career', 'portfolio']);
  });

  it('ignores empties and duplicates', () => {
    expect(addTag(['career'], '  ')).toEqual(['career']);
    expect(addTag(['career'], 'Career')).toEqual(['career']);
  });

  it('never mutates the input', () => {
    const tags = ['career'];
    addTag(tags, 'data');
    expect(tags).toEqual(['career']);
  });
});

describe('normalizeTags', () => {
  it('normalizes a whole list, keeping order and dropping duplicates', () => {
    expect(normalizeTags(['#Career', 'data science', 'career', '', 'Event'])).toEqual([
      'career',
      'data-science',
      'event',
    ]);
  });
});
