import { useEffect, useState } from 'react';
import { buildQr, loadQrEncoder, shortUrl, type QrMatrix } from './qr';

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
