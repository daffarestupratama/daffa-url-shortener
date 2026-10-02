import type { QrMatrix } from '../lib/qr';
import styles from './qr.module.css';

interface QrCodeProps {
  /** Null while the encoder loads, which shows the design's "Loading QR" box. */
  matrix: QrMatrix | null;
  slug: string;
  size: number;
}

/** The QR code as crisp SVG modules, used by the QR modal and the public result card. */
export function QrCode({ matrix, slug, size }: QrCodeProps) {
  if (!matrix) {
    return (
      <div className={size >= 240 ? styles.loadingLarge : styles.loading} style={{ width: size, height: size }}>
        Loading QR
      </div>
    );
  }
  return (
    <svg
      className={styles.svg}
      viewBox={`0 0 ${matrix.size} ${matrix.size}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code for daffa.me/${slug}`}
    >
      <path d={matrix.path} className={styles.modules} />
    </svg>
  );
}
