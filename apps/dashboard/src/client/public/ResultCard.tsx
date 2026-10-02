import { hostOf, PUBLIC_DAILY_CLICK_LIMIT, type PublicCreateResult } from '@daffa/shared';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/controls';
import { CheckIcon, CopyIcon } from '../components/Icons';
import { QrCode } from '../components/QrCode';
import { Badge, GateTile } from '../components/tiles';
import { copyShortLink } from '../lib/clipboard';
import { formatNumber } from '../lib/format';
import { downloadQr } from '../lib/qr';
import type { ToastFn } from '../lib/toast';
import { useQrMatrix } from '../lib/useQr';
import styles from './public.module.css';

interface ResultCardProps {
  result: PublicCreateResult;
  toast: ToastFn;
  /** Moves focus to the card and scrolls it into view, after a real create but not in a preview. */
  announce: boolean;
}

/**
 * SHORT LINK READY: the new short link with copy, its destination, and the QR
 * code with both downloads. The QR encoder loads only once a result exists.
 */
export function ResultCard({ result, toast, announce }: ResultCardProps) {
  const { slug, url } = result;
  const matrix = useQrMatrix(slug);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  // A new result takes focus, so keyboard and screen reader users land on it.
  useEffect(() => {
    if (!announce) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest('section')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, [slug, announce]);

  const copy = async () => {
    await copyShortLink(slug, toast);
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  const download = (kind: 'png' | 'svg') => {
    if (matrix) toast(`Downloaded ${downloadQr(slug, kind, matrix)}`);
  };

  return (
    <section aria-live="polite" aria-labelledby="res-title" className={styles.result}>
      <div className={styles.resultMain}>
        <div className={styles.resultHead}>
          <Badge tone="ok">ACTIVE</Badge>
          <h2 id="res-title" ref={heading} tabIndex={-1} className={styles.resultTitle}>
            SHORT LINK READY
          </h2>
        </div>
        <div className={styles.resultLink}>
          <GateTile slug={slug} variant="result" prefix="domain" />
          <Button variant="secondary" onClick={copy} aria-label={copied ? `Copied daffa.me/${slug}` : `Copy daffa.me/${slug}`}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <div className={styles.destination}>
          <span className={styles.destinationLabel}>DESTINATION</span>
          <span className={styles.destinationHost}>{hostOf(url)}</span>
          <a href={url} target="_blank" rel="noopener nofollow noreferrer" className={styles.destinationUrl}>
            {url}
          </a>
        </div>
        <p className={styles.resultNote}>
          Visitors see a short notice with the destination before continuing. Each public link opens up to{' '}
          {formatNumber(PUBLIC_DAILY_CLICK_LIMIT)} times per day.
        </p>
      </div>
      <div className={styles.resultQr}>
        <div className={styles.qrBox}>
          <QrCode matrix={matrix} slug={slug} size={200} />
          <span className={styles.qrCaption}>daffa.me/{slug}</span>
        </div>
        <div className={styles.qrButtons}>
          <Button variant="primary" disabled={!matrix} onClick={() => download('png')}>
            Download PNG
          </Button>
          <Button variant="secondary" disabled={!matrix} onClick={() => download('svg')}>
            Download SVG
          </Button>
        </div>
      </div>
    </section>
  );
}
