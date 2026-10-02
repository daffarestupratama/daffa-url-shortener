import { COLORS, GRADIENTS, SHADOWS } from '@daffa/shared';
import { describe, expect, it } from 'vitest';
import css from '../styles/tokens.css?raw';

/** Every custom property declared in tokens.css, with whitespace normalized. */
function declared(): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(match[1]!, match[2]!.replace(/\s+/g, ' ').trim());
  }
  return map;
}

const normalize = (value: string) => value.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim().toUpperCase();

describe('tokens.css matches shared/tokens.ts', () => {
  const tokens = declared();

  it('declares every shared color with the same value', () => {
    for (const [name, value] of Object.entries(COLORS)) {
      expect(tokens.get(name), name).toBeDefined();
      expect(normalize(tokens.get(name)!), name).toBe(normalize(value));
    }
  });

  it('declares every shared shadow with the same value', () => {
    for (const [name, value] of Object.entries(SHADOWS)) {
      expect(tokens.get(name), name).toBeDefined();
      expect(normalize(tokens.get(name)!), name).toBe(normalize(value));
    }
  });

  it('declares every shared gradient with the same value', () => {
    for (const [name, value] of Object.entries(GRADIENTS)) {
      expect(tokens.get(name), name).toBeDefined();
      expect(normalize(tokens.get(name)!), name).toBe(normalize(value));
    }
  });

  it('keeps the design :root block values', () => {
    // Spot checks against Dashboard.dc.html line 16.
    expect(tokens.get('--bg')).toBe('#E4E8EE');
    expect(tokens.get('--sign')).toBe('#F5C400');
    expect(tokens.get('--line')).toBe('#7A8494');
  });
});
