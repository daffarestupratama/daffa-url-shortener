import type { ReactNode } from 'react';
import { buttonClass } from '../../components/controls';
import { LogoTile } from '../../components/tiles';
import { api } from '../../lib/api';
import { Link } from '../../lib/router';
import { useResource } from '../../lib/useResource';
import styles from './shell.module.css';

/** Cloudflare Access ends the session at this path. A full page navigation, not a client route. */
const SIGN_OUT_URL = '/cdn-cgi/access/logout';

export function Shell({ children }: { children: ReactNode }) {
  const me = useResource('me', (signal) => api.me(signal));
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand} aria-label="daffa.me Link Manager, all links">
          <LogoTile />
          <span className={styles.brandText}>
            <span className={styles.domain}>daffa.me</span>
            <span className={styles.product}>LINK MANAGER</span>
          </span>
        </Link>
        <div className={styles.account}>
          {me.data && <span className={styles.email}>{me.data.email}</span>}
          <a href={SIGN_OUT_URL} className={buttonClass('secondary', 'sm', styles.signOut)}>
            Sign out
          </a>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
