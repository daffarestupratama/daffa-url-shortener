import { describe, expect, it } from 'vitest';
import { areaPath, axisLabelShift, findPeak, linePath, noteShift, xAt, xLabelIndexes, yAt, yScale } from './chart';

describe('yScale, as in the design', () => {
  it('rounds up to a friendly step with headroom', () => {
    expect(yScale(0)).toEqual({ yMax: 2, step: 2 });
    expect(yScale(8)).toEqual({ yMax: 10, step: 2 });
    expect(yScale(40)).toEqual({ yMax: 50, step: 10 });
    expect(yScale(150)).toEqual({ yMax: 180, step: 20 });
    expect(yScale(900)).toEqual({ yMax: 1100, step: 100 });
    expect(yScale(1284)).toEqual({ yMax: 2000, step: 500 });
  });
});

describe('geometry', () => {
  it('spreads points across the width and puts zero on the baseline', () => {
    expect(xAt(0, 7)).toBe(0);
    expect(xAt(6, 7)).toBe(1000);
    expect(xAt(0, 1)).toBe(500);
    expect(yAt(0, 50)).toBe(260);
    expect(yAt(50, 50)).toBe(0);
  });

  it('draws the line and closes the area to the baseline', () => {
    expect(linePath([0, 10], 10)).toBe('M0.0 260.0 L1000.0 0.0');
    expect(areaPath([0, 10], 10)).toBe('M0.0 260.0 L1000.0 0.0 L1000 260 L0 260 Z');
    expect(areaPath([], 10)).toBe('');
  });
});

describe('xLabelIndexes', () => {
  it('labels about six points and always the last', () => {
    const labels = xLabelIndexes(30);
    expect(labels.at(-1)).toBe(29);
    expect(labels.length).toBeLessThanOrEqual(7);
  });

  it('drops a label that would crowd the last one', () => {
    // every = 5 for 30 points: 0 5 10 15 20 25 29. 25 sits 4 from the end, which is not under 3.
    expect(xLabelIndexes(30)).toEqual([0, 5, 10, 15, 20, 25, 29]);
    // every = 4 for 24 points: 0 4 8 12 16 20 23. 20 sits 3 from the end, not under 2.4.
    expect(xLabelIndexes(24)).toEqual([0, 4, 8, 12, 16, 20, 23]);
    // every = 2 for 7 points: 0 2 4 6. Fine.
    expect(xLabelIndexes(7)).toEqual([0, 2, 4, 6]);
    // every = 15 for 90 points: 0 15 30 45 60 75 89. 75 sits 14 from the end, not under 9.
    expect(xLabelIndexes(90)).toEqual([0, 15, 30, 45, 60, 75, 89]);
    // every = 2 for 11 points: 0 2 4 6 8 10. The last is already on the grid.
    expect(xLabelIndexes(11)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('handles a single point', () => {
    expect(xLabelIndexes(1)).toEqual([0]);
  });
});

describe('label anchoring', () => {
  it('keeps axis labels and notes inside the chart', () => {
    expect(axisLabelShift(0)).toBe('0%');
    expect(axisLabelShift(50)).toBe('-50%');
    expect(axisLabelShift(100)).toBe('-100%');
    expect(noteShift(10)).toBe('0%');
    expect(noteShift(50)).toBe('-50%');
    expect(noteShift(90)).toBe('-100%');
  });
});

describe('findPeak', () => {
  it('marks a clear spike', () => {
    expect(findPeak([2, 3, 2, 14, 3, 2, 1])).toBe(3);
  });

  it('ignores ordinary variation', () => {
    expect(findPeak([4, 5, 6, 5, 7, 6, 5])).toBeNull();
  });

  it('needs at least three non empty buckets', () => {
    expect(findPeak([0, 0, 9, 0, 1, 0])).toBeNull();
    expect(findPeak([0, 0, 0])).toBeNull();
  });

  it('uses the median of non empty buckets, so quiet gaps do not create a false peak', () => {
    // Non empty buckets 3, 4, 5, 6, peak: the median is 5, so a peak needs at least 15.
    // Counting the zeros would drop the median to 0 and flag almost anything.
    expect(findPeak([0, 3, 0, 4, 0, 5, 0, 6, 14])).toBeNull();
    expect(findPeak([0, 3, 0, 4, 0, 5, 0, 6, 15])).toBe(8);
  });
});
