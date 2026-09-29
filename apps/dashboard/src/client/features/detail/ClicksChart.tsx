import type { Analytics } from '@daffa/shared';
import { PanelTitle, Panel } from '../../components/surfaces';
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  areaPath,
  axisLabelShift,
  findPeak,
  linePath,
  noteShift,
  xAt,
  xLabelIndexes,
  yAt,
  yScale,
} from '../../lib/chart';
import { formatBucketLabel, formatNumber, spansYears } from '../../lib/format';
import styles from './detail.module.css';

/**
 * CLICKS OVER TIME. Charts are always flat: no shadows on the plot itself.
 * The single annotation marks a real spike only (see findPeak), since the
 * reason behind a spike is not something the data can tell.
 */
export function ClicksChart({ analytics, forceFlat = false }: { analytics: Analytics; forceFlat?: boolean }) {
  const points = forceFlat ? analytics.series.map((p) => ({ ...p, human: 0, unique: 0, bot: 0 })) : analytics.series;
  const human = points.map((p) => p.human);
  const unique = points.map((p) => p.unique);
  const count = points.length;
  const { yMax } = yScale(Math.max(0, ...human));
  const withYear = analytics.bucket === 'month' && spansYears(points.map((p) => p.start));
  const label = (index: number) => formatBucketLabel(points[index]!.start, analytics.bucket, withYear);
  const flat = forceFlat || analytics.totals.human === 0;

  const peak = flat ? null : findPeak(human);
  const peakLeft = peak === null ? 0 : xAt(peak, count) / 10;
  const peakTop = peak === null ? 0 : (yAt(human[peak]!, yMax) / CHART_HEIGHT) * 100;

  return (
    <Panel className={styles.chartPanel} aria-label="Clicks over time">
      <div className={styles.chartHead}>
        <PanelTitle>CLICKS OVER TIME</PanelTitle>
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.legendHuman} aria-hidden="true" />
            Human clicks
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendUnique} aria-hidden="true" />
            Unique visitors
          </span>
        </div>
      </div>

      <div className={styles.chartGrid}>
        <div className={styles.yAxis} aria-hidden="true">
          <span className={styles.yTop}>{formatNumber(yMax)}</span>
          <span className={styles.yMid}>{formatNumber(yMax / 2)}</span>
          <span className={styles.yZero}>0</span>
        </div>
        <div className={styles.plot}>
          <div className={`${styles.gridLine} ${styles.gridTop}`} />
          <div className={`${styles.gridLine} ${styles.gridMid}`} />
          <div className={`${styles.gridLine} ${styles.gridBase}`} />
          {count > 0 && (
            <svg
              className={styles.svg}
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              preserveAspectRatio="none"
              width="100%"
              height={CHART_HEIGHT}
              role="img"
              aria-label={`Human clicks ${analytics.range === 'all' ? 'per month' : analytics.bucket === 'hour' ? 'per hour' : 'per day'}, ${formatNumber(analytics.totals.human)} in total`}
            >
              <path className={styles.area} d={areaPath(human, yMax)} />
              <path className={styles.lineHuman} d={linePath(human, yMax)} vectorEffect="non-scaling-stroke" />
              <path className={styles.lineUnique} d={linePath(unique, yMax)} vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          {peak !== null && (
            <>
              <div className={styles.noteDot} style={{ left: `${peakLeft}%`, top: `${peakTop}%` }} />
              <div
                className={styles.noteBox}
                style={{
                  left: `${peakLeft}%`,
                  top: `${peakTop}%`,
                  transform: `translate(${noteShift(peakLeft)}, calc(-100% - 14px))`,
                }}
              >
                <span className={styles.noteHead}>
                  {label(peak)} {'·'} {formatNumber(human[peak]!)} clicks
                </span>
                Highest in this range
              </div>
            </>
          )}
        </div>
        <div />
        <div className={styles.xAxis} aria-hidden="true">
          {xLabelIndexes(count).map((index) => {
            const left = xAt(index, count) / 10;
            return (
              <span key={index} style={{ left: `${left}%`, transform: `translateX(${axisLabelShift(left)})` }}>
                {label(index)}
              </span>
            );
          })}
        </div>
      </div>

      {flat && <p className={styles.flat}>No human clicks in this range. Choose a longer range to see history.</p>}
    </Panel>
  );
}
