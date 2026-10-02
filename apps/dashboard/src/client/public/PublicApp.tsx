import type { PublicCreateResult } from '@daffa/shared';
import { useEffect, useState } from 'react';
import { ToastView } from '../components/overlay';
import { Kicker } from '../components/tiles';
import { useToast } from '../lib/toast';
import { ChainHero } from './ChainHero';
import { PublicFooter } from './PublicFooter';
import { PublicForm } from './PublicForm';
import { PublicHeader } from './PublicHeader';
import { publicPreview } from './preview';
import { RateLimitDialog, type RateLimit } from './RateLimitDialog';
import { ResultCard } from './ResultCard';
import styles from './public.module.css';

/**
 * The public page at /. Default export for the lazy import in main.tsx. It
 * never sets document.title, so the static title and meta tags of index.html
 * stay as they are.
 */
export default function PublicApp() {
  // Dev only, null in production: a forced state from ?state= or ?overlay=.
  const [preview] = useState(() => publicPreview(window.location.search));
  const { message, toast } = useToast();
  const [result, setResult] = useState<PublicCreateResult | null>(preview?.result ?? null);
  const [announce, setAnnounce] = useState(false);
  const [rate, setRate] = useState<RateLimit | null>(preview?.rate ?? null);

  useEffect(() => {
    if (preview?.toast) toast(preview.toast, { sticky: true });
  }, [preview, toast]);

  return (
    <div className={styles.page}>
      <PublicHeader />
      <main className={styles.main}>
        <div className={styles.heroGrid}>
          <div className={styles.intro}>
            <Kicker>PUBLIC URL SHORTENER</Kicker>
            <h1 className={styles.h1}>Short links for everyone</h1>
            <p className={styles.lede}>
              Any long URL becomes a short daffa.me link with a QR code, free and without an account.
            </p>
          </div>
          <div className={styles.heroArt}>
            <ChainHero still={preview?.stillHero ?? false} />
          </div>
        </div>

        <PublicForm
          force={preview?.form}
          preview={preview !== null}
          loadTurnstile={preview?.loadTurnstile ?? true}
          onCreated={(created) => {
            setResult(created);
            setAnnounce(true);
          }}
          onRateLimited={setRate}
        />

        {result && <ResultCard result={result} toast={toast} announce={announce} />}
      </main>
      <PublicFooter />
      {rate && <RateLimitDialog limit={rate} onClose={() => setRate(null)} />}
      <ToastView message={message} />
    </div>
  );
}
