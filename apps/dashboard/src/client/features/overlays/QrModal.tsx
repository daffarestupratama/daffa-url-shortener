import { useEffect, useState } from 'react';
import { Button, IconButton } from '../../components/controls';
import { Dialog } from '../../components/overlay';
import { GateTile } from '../../components/tiles';
import { buildQr, downloadFile, loadQrEncoder, qrFileName, qrPngDataUrl, qrSvgFile, shortUrl, type QrMatrix } from '../../lib/qr';
import { useApp, type LinkRef } from '../app/AppProvider';
import styles from './overlays.module.css';

/** Loads the encoder on first use and builds the matrix for a slug. */
export function useQrMatrix(slug: string): QrMatrix | null {
  const [matrix, setMatrix] = useState<QrMatrix | null>(null);
  useEffect(() => {
    let active = true;
    loadQrEncoder().then((encoder) => {
      if (active) setMatrix(buildQr(encoder, shortUrl(slug)));
    });
    return () => {
      active = false;
    };
  }, [slug]);
  return matrix;
}

export function QrModal({ link, onClose }: { link: LinkRef; onClose: () => void }) {
  const { toast } = useApp();
  const matrix = useQrMatrix(link.slug);

  const download = (kind: 'png' | 'svg') => {
    if (!matrix) return;
    const name = qrFileName(link.slug, kind);
    if (kind === 'svg') {
      const url = URL.createObjectURL(new Blob([qrSvgFile(matrix)], { type: 'image/svg+xml' }));
      downloadFile(url, name);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      downloadFile(qrPngDataUrl(matrix), name);
    }
    toast(`Downloaded ${name}`);
  };

  return (
    <Dialog layer="qr" labelledBy="qr-title" onClose={onClose} className={styles.qrDialog}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.kicker}>QR CODE</span>
          <h2 id="qr-title" className={styles.qrTitle}>
            {link.title}
          </h2>
        </div>
        <IconButton size={44} label="Close" onClick={onClose}>
          {'×'}
        </IconButton>
      </div>
      <div className={styles.qrBox}>
        {matrix ? (
          <svg
            className={styles.qrSvg}
            viewBox={`0 0 ${matrix.size} ${matrix.size}`}
            width="240"
            height="240"
            shapeRendering="crispEdges"
            role="img"
            aria-label={`QR code for daffa.me/${link.slug}`}
          >
            <path d={matrix.path} style={{ fill: 'var(--ink)' }} />
          </svg>
        ) : (
          <div className={styles.qrLoading}>Loading QR</div>
        )}
        <GateTile slug={link.slug} variant="qr" prefix="domain" className={styles.qrUrl} />
      </div>
      <p className={styles.qrNote}>
        The QR code contains the short address daffa.me/{link.slug}, not the destination URL. Printed codes keep
        working even if the destination changes later.
      </p>
      <div className={styles.downloads}>
        <Button variant="primary" disabled={!matrix} onClick={() => download('png')}>
          Download PNG
        </Button>
        <Button variant="secondary" disabled={!matrix} onClick={() => download('svg')}>
          Download SVG
        </Button>
      </div>
    </Dialog>
  );
}
