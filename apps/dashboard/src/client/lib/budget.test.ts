import { describe, expect, it } from 'vitest';
import { budgetMeter } from './budget';

describe('budgetMeter', () => {
  it('starts empty and ink', () => {
    expect(budgetMeter(0, 20_000)).toEqual({ width: 0, text: '0,0%', tone: 'ink' });
  });

  it('shows one decimal below 10 percent', () => {
    expect(budgetMeter(851, 20_000).text).toBe('4,3%');
  });

  it('shows whole numbers from 10 percent', () => {
    expect(budgetMeter(2_500, 20_000).text).toBe('13%');
  });

  it('turns orange at 70 percent and red at 90 percent', () => {
    expect(budgetMeter(13_980, 20_000).tone).toBe('ink');
    expect(budgetMeter(14_000, 20_000).tone).toBe('exp');
    expect(budgetMeter(17_980, 20_000).tone).toBe('exp');
    expect(budgetMeter(18_000, 20_000).tone).toBe('danger');
  });

  it('caps the fill at 100 when the budget is exceeded', () => {
    const meter = budgetMeter(25_000, 20_000);
    expect(meter.width).toBe(100);
    expect(meter.text).toBe('125%');
    expect(meter.tone).toBe('danger');
  });

  it('treats a missing budget as empty', () => {
    expect(budgetMeter(10, 0)).toEqual({ width: 0, text: '0,0%', tone: 'ink' });
  });
});
