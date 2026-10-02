/**
 * The public click budget meter in the KPI row. The fill turns orange at 70%
 * and red at 90%, per the component system. The percentage uses the same
 * id-ID formatting as every other number, so 4.3 percent reads 4,3%.
 */

export type BudgetTone = 'ink' | 'exp' | 'danger';

export interface BudgetMeter {
  /** Fill width in percent, 0 to 100. */
  width: number;
  /** "4,3%" below 10 percent, whole numbers from there on. */
  text: string;
  tone: BudgetTone;
}

const oneDecimal = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

export function budgetMeter(used: number, budget: number): BudgetMeter {
  const percent = budget > 0 ? (Math.max(0, used) / budget) * 100 : 0;
  return {
    width: Math.min(100, percent),
    text: `${percent < 10 ? oneDecimal.format(percent) : whole.format(percent)}%`,
    tone: percent >= 90 ? 'danger' : percent >= 70 ? 'exp' : 'ink',
  };
}
