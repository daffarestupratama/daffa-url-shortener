import styles from './hero.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

const RINGS = [styles.r0, styles.r1, styles.r2];
const BARS = [styles.b0, styles.b1];

/**
 * Three silver chain links, from the design's hero: face on rings and edge on
 * bars on the page background. Each bar passes over one rim and under the
 * next, which the clipped caps of the second and third ring draw. Plain
 * elements and CSS only, no library and no canvas. The rings rock and the
 * chain floats on a 7 to 10 second loop. With prefers-reduced-motion, or with
 * `still`, it shows the static frame from the component system.
 */
export function ChainHero({ still = false }: { still?: boolean }) {
  return (
    <div role="img" aria-label="Three silver chain links joined together" className={cx(styles.hero, still && styles.still)}>
      <div className={styles.float}>
        {RINGS.map((position, index) => (
          <span key={index} className={styles.group}>
            <span className={cx(styles.ring, position)} />
            {index > 0 && <span className={cx(styles.ring, styles.cap, position)} />}
            {index < 2 && (
              <span className={cx(styles.bar, BARS[index])}>
                <span className={styles.groove} />
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
