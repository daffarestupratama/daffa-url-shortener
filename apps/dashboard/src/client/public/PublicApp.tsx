import { Kicker } from '../components/tiles';
import { PublicFooter } from './PublicFooter';
import { PublicHeader } from './PublicHeader';
import styles from './public.module.css';

/**
 * The public page at /. Default export for the lazy import in main.tsx. It
 * never sets document.title, so the static title and meta tags of index.html
 * stay as they are.
 */
export default function PublicApp() {
  return (
    <div className={styles.page}>
      <PublicHeader />
      <main className={styles.main}>
        <div className={styles.intro}>
          <Kicker>PUBLIC URL SHORTENER</Kicker>
          <h1 className={styles.h1}>Short links for everyone</h1>
          <p className={styles.lede}>
            Any long URL becomes a short daffa.me link with a QR code, free and without an account.
          </p>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
