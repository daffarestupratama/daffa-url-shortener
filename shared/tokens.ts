/**
 * Canonical design token values, copied from the handoff bundle rather than
 * recalculated. The dashboard ships these as styles/tokens.css and the
 * redirector builds a trimmed inline :root block from them for the visitor
 * pages. Light mode only for now, but everything is a variable so a dark
 * palette can be added later without touching component code.
 *
 * The first block is the :root from Dashboard.dc.html. The second block
 * promotes colors the design still had hardcoded inline.
 */
export const COLORS = {
  '--bg': '#E4E8EE',
  '--bg-hover': '#ECEFF3',
  '--sh-l': '#FFFFFF',
  '--sh-d': '#B8C0CC',
  '--line': '#7A8494',
  '--hair': '#C3CAD4',
  '--ink': '#14171C',
  '--ink2': '#4A5260',
  '--sign': '#F5C400',
  '--link': '#1F5FBF',
  '--ok': '#1E7F4F',
  '--off': '#5B6472',
  '--exp': '#B4501A',
  '--danger': '#C62828',
  '--bot': '#6B4FBB',
  '--bot-tint': '#E9E4F5',
  '--track': '#CFD5DE',

  '--sign-hover': '#FFD21F',
  '--link-hover': '#174A96',
  '--danger-border': '#8E1C1C',
  '--danger-hover': '#B02323',
  '--danger-lo': '#E25555',
  '--sign-shadow-d': '#B89400',
  '--sign-shadow-l': '#FFE36B',
  '--chip-x-hover': '#3A404A',
  '--danger-tint': '#F6E3E3',
  '--code-bg': '#F3F5F8',
  '--tile-prefix': '#8E97A6',
  '--tile-hi': '#2A3039',
  '--tile-lo': '#0C0E12',
  '--switch-on': '#BFDCCB',
  '--skeleton-1': '#CCD3DC',
  '--skeleton-2': '#D6DCE4',
  '--qr-bg': '#FFFFFF',
} as const;

/**
 * Three depth levels. `raise` for containers and clickable controls, `inset`
 * for inputs, active selections and status badges, and nothing at all for text,
 * table rows, charts and rank bars.
 */
export const SHADOWS = {
  '--raise-lg': '6px 6px 12px #B8C0CC,-6px -6px 12px #FFFFFF',
  '--raise-sm': '3px 3px 6px #B8C0CC,-3px -3px 6px #FFFFFF',
  '--inset': 'inset 3px 3px 6px #B8C0CC,inset -3px -3px 6px #FFFFFF',
  '--tile-in':
    '10px 12px 22px rgba(20,23,28,0.45),3px 4px 6px rgba(20,23,28,0.35),-8px -8px 16px #FFFFFF,inset 1px 1px 0 rgba(255,255,255,0.22),inset -2px -2px 1px rgba(0,0,0,0.6)',
  '--badge-in':
    'inset 2px 2px 4px rgba(0,0,0,0.45),inset -1px -1px 3px rgba(255,255,255,0.18),0 1px 0 rgba(255,255,255,0.8)',
  '--badge-in-strong':
    'inset 2px 2px 4px rgba(0,0,0,0.75),inset -1px -1px 3px rgba(255,255,255,0.14),0 1px 0 rgba(255,255,255,0.8)',
  '--lift':
    'inset 0 1px 0 rgba(255,255,255,0.7),0 1px 2px rgba(20,23,28,0.18),0 12px 28px -6px rgba(20,23,28,0.35)',
  '--knob': '2px 2px 4px rgba(20,23,28,0.35),-1px -1px 3px rgba(255,255,255,0.8)',
  '--drawer': '-8px 0 24px rgba(20,23,28,0.25)',
  '--sign-active': 'inset 3px 3px 6px #B89400,inset -3px -3px 6px #FFE36B',
  '--danger-active': 'inset 3px 3px 6px #8E1C1C,inset -2px -2px 5px #E25555',
} as const;

export const FONTS = {
  '--font': "'Atkinson Hyperlegible Next',system-ui,sans-serif",
  '--mono': "'Atkinson Hyperlegible Mono','IBM Plex Mono',ui-monospace,monospace",
  /** The visitor pages carry no web fonts, so they use the system stacks. */
  '--font-system': "system-ui,-apple-system,'Segoe UI',sans-serif",
  '--mono-system': 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
} as const;

export type TokenName = keyof typeof COLORS | keyof typeof SHADOWS | keyof typeof FONTS;

const ALL: Record<string, string> = { ...COLORS, ...SHADOWS, ...FONTS };

export function tokenValue(name: TokenName): string {
  const value = ALL[name];
  if (value === undefined) throw new Error(`Unknown design token: ${name}`);
  return value;
}

/**
 * Emits a `:root` rule holding only the tokens asked for. The visitor pages use
 * this to stay well under their 3 KB budget while still keeping every color in
 * a variable.
 */
export function rootRule(names: readonly TokenName[]): string {
  const unique = [...new Set(names)];
  const declarations = unique.map((name) => `${name}:${tokenValue(name)}`);
  return `:root{${declarations.join(';')}}`;
}
