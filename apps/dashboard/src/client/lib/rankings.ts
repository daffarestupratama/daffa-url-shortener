import { formatNumber, formatPercent } from './format';

export interface RankRow {
  key: string;
  label: string;
  count: number;
  /** Display count, "1.014". */
  countText: string;
  /** Share of the range total, "79%". */
  pct: string;
  /** Bar width relative to the largest row, "100%". */
  width: string;
  /** ISO country code for a flag, when the ranking is by country. */
  country?: string | null;
  /** The remainder row. */
  other?: boolean;
}

export interface RankInput {
  key: string;
  label: string;
  count: number;
  country?: string | null;
}

/**
 * The top rows plus an "Other" row holding the remainder of `total`, when there
 * is one. Percentages are shares of the total and bar widths are relative to
 * the largest row, as in the design's rk() helper.
 */
export function withOther(items: readonly RankInput[], total: number, limit = 6): RankRow[] {
  const top = [...items].sort((a, b) => b.count - a.count).slice(0, limit);
  const rest = total - top.reduce((sum, item) => sum + item.count, 0);
  const rows: RankInput[] = rest > 0 ? [...top, { key: '__other__', label: 'Other', count: rest }] : top;
  const max = Math.max(1, ...rows.map((row) => row.count));
  return rows.map((row) => ({
    ...row,
    countText: formatNumber(row.count),
    pct: formatPercent(row.count, total),
    width: `${(row.count / max) * 100}%`,
    other: row.key === '__other__',
  }));
}
