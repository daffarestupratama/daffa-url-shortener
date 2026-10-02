import { Button, IconButton } from '../../components/controls';
import { Dialog } from '../../components/overlay';
import { QrCode } from '../../components/QrCode';
import { GateTile } from '../../components/tiles';
import { downloadQr } from '../../lib/qr';
import { useQrMatrix } from '../../lib/useQr';
import { useApp, type LinkRef } from '../app/AppProvider';
import styles from './overlays.module.css';

export function QrModal({ link, onClose }: { link: LinkRef; onClose: () => void }) {
  const { toast } = useApp();
  const matrix = useQrMatrix(link.slug);

  const download = (kind: 'png' | 'svg') => {
    if (!matrix) return;
    toast(`Downloaded ${downloadQr(link.slug, kind, matrix)}`);
  };

  return (
    <Dialog kind="dialog" level={60} labelledBy="qr-title" onClose={onClose} className={styles.qrDialog}>
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
        <QrCode matrix={matrix} slug={link.slug} size={240} />
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
