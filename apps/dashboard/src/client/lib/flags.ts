/**
 * Country flags and names. The design uses emoji flags, which Chrome on
 * Windows renders as two letters, so the dashboard uses bundled SVG files
 * instead (see flagUrls.ts). This module holds the pure lookup logic.
 */

const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' });

/** A two letter ISO code usable for a flag lookup, or null. */
export function normalizeCountry(code: string | null | undefined): string | null {
  if (!code) return null;
  const upper = code.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}

/** "ID" becomes "Indonesia". Unknown codes stay as the code. Null means no country at all. */
export function countryName(code: string | null | undefined): string {
  if (!code) return 'Unknown';
  const normalized = normalizeCountry(code);
  if (!normalized) return code;
  try {
    return regionNames.of(normalized) ?? normalized;
  } catch {
    return normalized;
  }
}

export type FlagLookup =
  | { kind: 'image'; url: string; code: string }
  | { kind: 'code'; code: string }
  | { kind: 'none' };

/**
 * Picks what to render for a country: the SVG when there is one, the code in
 * a small chip when there is not (Cloudflare reports T1 for Tor, XX for
 * unknown), and nothing for a missing value.
 */
export function lookupFlag(code: string | null | undefined, table: Readonly<Record<string, string>>): FlagLookup {
  if (!code) return { kind: 'none' };
  const normalized = normalizeCountry(code);
  const url = normalized ? table[normalized] : undefined;
  if (url && normalized) return { kind: 'image', url, code: normalized };
  return { kind: 'code', code: code.trim().toUpperCase().slice(0, 3) };
}
