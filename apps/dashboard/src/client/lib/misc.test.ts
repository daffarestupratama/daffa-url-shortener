import { describe, expect, it } from 'vitest';
import { coloCity } from './colos';
import { countryName, lookupFlag, normalizeCountry } from './flags';
import { withOther } from './rankings';
import { pickEnum, pickPositiveInt, withParams } from './useQuery';

describe('flags', () => {
  const table = { ID: '/assets/ID.svg', SG: '/assets/SG.svg' };

  it('uses the SVG when the country has one', () => {
    expect(lookupFlag('ID', table)).toEqual({ kind: 'image', url: '/assets/ID.svg', code: 'ID' });
    expect(lookupFlag('sg', table)).toEqual({ kind: 'image', url: '/assets/SG.svg', code: 'SG' });
  });

  it('falls back to the code for countries without a flag file', () => {
    expect(lookupFlag('T1', table)).toEqual({ kind: 'code', code: 'T1' });
    expect(lookupFlag('XX', table)).toEqual({ kind: 'code', code: 'XX' });
  });

  it('shows nothing when there is no country', () => {
    expect(lookupFlag(null, table)).toEqual({ kind: 'none' });
    expect(lookupFlag('', table)).toEqual({ kind: 'none' });
  });

  it('names countries in English', () => {
    expect(countryName('ID')).toBe('Indonesia');
    expect(countryName('US')).toBe('United States');
    expect(countryName(null)).toBe('Unknown');
    expect(normalizeCountry('T1')).toBeNull();
  });
});

describe('colos', () => {
  it('knows the data centers the seed uses and tolerates unknown codes', () => {
    expect(coloCity('CGK')).toBe('Jakarta');
    expect(coloCity('sin')).toBe('Singapore');
    expect(coloCity('ZZZ')).toBeNull();
    expect(coloCity(null)).toBeNull();
  });
});

describe('withOther', () => {
  const items = [
    { key: 'a', label: 'A', count: 50 },
    { key: 'b', label: 'B', count: 30 },
    { key: 'c', label: 'C', count: 10 },
  ];

  it('adds an Other row for the remainder of the total', () => {
    const rows = withOther(items, 100, 2);
    expect(rows.map((row) => row.label)).toEqual(['A', 'B', 'Other']);
    expect(rows.at(-1)).toMatchObject({ count: 20, pct: '20%', other: true });
  });

  it('skips Other when nothing is left over', () => {
    expect(withOther(items, 90).map((row) => row.label)).toEqual(['A', 'B', 'C']);
  });

  it('shares are of the total, bar widths relative to the largest row', () => {
    const [first, second] = withOther(items, 90);
    expect(first).toMatchObject({ pct: '56%', width: '100%', countText: '50' });
    expect(second?.width).toBe('60%');
  });
});

describe('URL state', () => {
  it('drops defaults and empties, keeps everything else', () => {
    expect(withParams('', { status: { value: 'all', fallback: 'all' } })).toBe('');
    expect(withParams('?q=cv', { status: { value: 'expired', fallback: 'all' } })).toBe('?q=cv&status=expired');
    expect(withParams('?q=cv&status=expired', { q: { value: '', fallback: '' } })).toBe('?status=expired');
    expect(withParams('?range=7d&page=3', { range: { value: '30d', fallback: '30d' }, page: { value: '1', fallback: '1' } })).toBe('');
  });

  it('never lets an invalid URL value through', () => {
    expect(pickEnum('expired', ['all', 'expired'] as const, 'all')).toBe('expired');
    expect(pickEnum('aktif', ['all', 'expired'] as const, 'all')).toBe('all');
    expect(pickEnum(null, ['all'] as const, 'all')).toBe('all');
    expect(pickPositiveInt('3', 1)).toBe(3);
    for (const bad of ['0', '-1', '1.5', 'abc', '99999999', null]) expect(pickPositiveInt(bad, 1)).toBe(1);
  });
});
