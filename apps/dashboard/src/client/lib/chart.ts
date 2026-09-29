/**
 * Chart geometry, ported from the design prototype (Dashboard.dc.html, lines
 * 830 to 838). The SVG uses a 1000 by 260 viewBox stretched to the container,
 * with non scaling strokes, so all math happens in those units.
 */

export const CHART_WIDTH = 1000;
export const CHART_HEIGHT = 260;

/** Rounds the top of the axis up to a friendly step, with 18 percent headroom. */
export function yScale(maxValue: number): { yMax: number; step: number } {
  const max = Math.max(1, maxValue);
  const step = max <= 10 ? 2 : max <= 50 ? 10 : max <= 200 ? 20 : max <= 1000 ? 100 : 500;
  return { yMax: Math.ceil((max * 1.18) / step) * step, step };
}

export function xAt(index: number, count: number): number {
  return count <= 1 ? CHART_WIDTH / 2 : (index / (count - 1)) * CHART_WIDTH;
}

export function yAt(value: number, yMax: number): number {
  return CHART_HEIGHT - (value / yMax) * CHART_HEIGHT;
}

export function linePath(values: readonly number[], yMax: number): string {
  return values
    .map((value, i) => `${i ? 'L' : 'M'}${xAt(i, values.length).toFixed(1)} ${yAt(value, yMax).toFixed(1)}`)
    .join(' ');
}

export function areaPath(values: readonly number[], yMax: number): string {
  if (values.length === 0) return '';
  const n = values.length;
  return `${linePath(values, yMax)} L${xAt(n - 1, n)} ${CHART_HEIGHT} L${xAt(0, n)} ${CHART_HEIGHT} Z`;
}

/**
 * About six evenly spaced labels, always including the last point, and dropping
 * a regular label that would crowd the last one. Same rule as the design.
 */
export function xLabelIndexes(count: number): number[] {
  const every = Math.max(1, Math.ceil(count / 6));
  const candidates: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i % every === 0 || i === count - 1) candidates.push(i);
  }
  return candidates.filter(
    (i) => !(i !== count - 1 && candidates.length > 1 && count - 1 - i < every * 0.6),
  );
}

/** Horizontal anchoring for an axis label at `leftPercent`, keeping it inside the chart. */
export function axisLabelShift(leftPercent: number): string {
  return leftPercent > 95 ? '-100%' : leftPercent < 5 ? '0%' : '-50%';
}

/** Horizontal anchoring for an annotation box, which is wider than an axis label. */
export function noteShift(leftPercent: number): string {
  return leftPercent > 70 ? '-100%' : leftPercent < 30 ? '0%' : '-50%';
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The bucket worth annotating, or null. There must be at least three non empty
 * buckets, and the highest must be at least three times their median, so the
 * marker only appears on a real spike and never on flat or sparse data.
 */
export function findPeak(values: readonly number[]): number | null {
  const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonZero.length < 3) return null;
  const highest = nonZero[nonZero.length - 1]!;
  if (highest < 3 * median(nonZero)) return null;
  return values.indexOf(highest);
}
