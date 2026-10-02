import { buttonClass } from '../components/controls';
import { LogoTile } from '../components/tiles';
import styles from './public.module.css';

/**
 * Sign In is a plain link, not a client route: /dashboard sits behind
 * Cloudflare Access, which only runs on a real page load.
 */
export function PublicHeader() {
  return (
    <header className={styles.header}>
      <a href="/" className={styles.brand} aria-label="daffa.me link shortener home">
        <LogoTile />
        <span className={styles.brandText}>
          <span className={styles.domain}>daffa.me</span>
          <span className={styles.product}>LINK SHORTENER</span>
        </span>
      </a>
      <div className={styles.account}>
        <span className={styles.visitor}>
          <span className={styles.visitorDot} aria-hidden="true" />
          Public Visitor
        </span>
        <span className={styles.spacer} aria-hidden="true" />
        <a href="/dashboard" className={buttonClass('secondary', 'sm', styles.signIn)}>
          Sign In
        </a>
      </div>
    </header>
  );
}
