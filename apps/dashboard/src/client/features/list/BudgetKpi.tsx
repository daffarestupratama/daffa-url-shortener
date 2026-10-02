import { KpiCard } from '../../components/surfaces';
import { budgetMeter } from '../../lib/budget';
import { formatNumber } from '../../lib/format';
import styles from './list.module.css';

interface BudgetKpiProps {
  /** Clicks of all public links in the current UTC day. Undefined while the summary loads. */
  used: number | undefined;
  budget: number | undefined;
  publicTotal: number | undefined;
}

/** PUBLIC CLICKS · TODAY: the shared daily budget of public links, against its limit. */
export function BudgetKpi({ used, budget, publicTotal }: BudgetKpiProps) {
  const loaded = used !== undefined && budget !== undefined && publicTotal !== undefined;
  const meter = budgetMeter(used ?? 0, budget ?? 0);
  return (
    <KpiCard
      label={`PUBLIC CLICKS · TODAY`}
      value={
        <span className={styles.budgetValue}>
          <span>{loaded ? formatNumber(used) : '…'}</span>
          {budget !== undefined && <span className={styles.budgetOf}>/ {formatNumber(budget)}</span>}
        </span>
      }
      foot={loaded ? `${meter.text} of daily budget · ${formatNumber(publicTotal)} public links` : ' '}
    >
      <div
        role="progressbar"
        aria-label="Daily public click budget used"
        aria-valuemin={0}
        aria-valuemax={budget ?? 0}
        aria-valuenow={used ?? 0}
        className={styles.budgetTrack}
      >
        <div className={`${styles.budgetFill} ${styles[`budget_${meter.tone}`]}`} style={{ width: `${meter.width}%` }} />
      </div>
    </KpiCard>
  );
}
