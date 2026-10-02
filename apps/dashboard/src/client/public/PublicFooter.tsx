import styles from './public.module.css';

export function PublicFooter() {
  return (
    <footer className={styles.footer}>
      <span>
        Built by{' '}
        <a href="https://daffarestupratama.com" className={styles.author}>
          Daffa Ilham Restupratama
        </a>
      </span>
      <a href="mailto:contact@daffarestupratama.com?subject=Report%20abuse" className={styles.report}>
        Report abuse
      </a>
    </footer>
  );
}
