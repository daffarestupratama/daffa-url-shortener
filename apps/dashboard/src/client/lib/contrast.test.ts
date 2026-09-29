import { COLORS } from '@daffa/shared';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.x contrast, computed from the token values themselves. Text needs
 * 4.5:1 (AA, normal size, which covers the 11 to 16 px labels in the design)
 * and control borders need 3:1 (non-text contrast).
 *
 * A pair that falls short is a finding against the design. It is recorded in
 * FINDINGS with its measured ratio instead of being fixed by quietly changing
 * a token, and the test pins the ratio so any change to it is noticed.
 */

type Token = keyof typeof COLORS;

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: Token, b: Token): number {
  const la = luminance(COLORS[a]);
  const lb = luminance(COLORS[b]);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

const TEXT: Array<[Token, Token, string]> = [
  ['--ink', '--bg', 'body text'],
  ['--ink2', '--bg', 'secondary text'],
  ['--link', '--bg', 'links and unique visitor figures'],
  ['--danger', '--bg', 'error messages'],
  ['--ok', '--bg', 'success message and ACTIVE label'],
  ['--off', '--bg', 'INACTIVE label'],
  ['--bot', '--bg', 'bot figures'],
  ['--ink', '--track', 'tag chips'],
  ['--ink', '--sign', 'primary button'],
  ['--ink', '--code-bg', 'ASN and data center chips'],
  ['--ink2', '--bot-tint', 'secondary text on bot rows'],
  ['--on-color', '--ok', 'ACTIVE badge'],
  ['--on-color', '--off', 'INACTIVE badge'],
  ['--on-color', '--exp', 'EXPIRED badge'],
  ['--on-color', '--danger', 'danger badge and button'],
  ['--on-color', '--bot', 'BOT badge'],
  ['--on-color', '--ink', 'toast and dark tag chips'],
  ['--sign', '--tile-hi', 'gate tile slug, light end of the gradient'],
  ['--sign', '--tile-lo', 'gate tile slug, dark end of the gradient'],
  ['--sign', '--ink', 'NOT FOUND badge and chart note heading'],
  ['--tile-prefix', '--tile-hi', 'gate tile prefix, light end of the gradient'],
  ['--tile-prefix', '--tile-lo', 'gate tile prefix, dark end of the gradient'],
];

/** Measured shortfalls, reported rather than changed. */
const FINDINGS: Array<[Token, Token, string, number]> = [
  // Design finding: the ACTIVE switch label (800 12px) and "Slug is available."
  // (700 14px) both use --ok on --bg. Neither is large text under WCAG, so
  // 4.5:1 applies. The green badge (white on --ok) passes.
  ['--ok', '--bg', 'success message and ACTIVE label', 4.06],
];

describe('WCAG AA text contrast from the tokens', () => {
  for (const [fg, bg, use] of TEXT) {
    if (FINDINGS.some(([f, b]) => f === fg && b === bg)) continue;
    it(`${fg} on ${bg}, ${use}: at least 4.5:1`, () => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('non text contrast', () => {
  it('--line on --bg, the border every control keeps: at least 3:1', () => {
    expect(contrast('--line', '--bg')).toBeGreaterThanOrEqual(3);
  });
});

describe('recorded findings', () => {
  for (const [fg, bg, use, ratio] of FINDINGS) {
    it(`${fg} on ${bg}, ${use}: measured ${ratio.toFixed(2)}:1, below 4.5`, () => {
      expect(contrast(fg, bg)).toBeCloseTo(ratio, 2);
    });
  }
});
