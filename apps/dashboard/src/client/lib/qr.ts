import { COLORS } from '@daffa/shared';

/**
 * QR codes, ported from qrOf() and download() in the design prototype. The
 * encoder is loaded on demand, so it stays out of the main bundle until a QR
 * code is first shown. Error correction level M, a 4 module quiet zone in the
 * downloads, and file names like daffa-me-cv.png, as in the design.
 *
 * The code always encodes the short address, never the destination, so a
 * printed code keeps working when the destination changes.
 */

type QrFactory = typeof import('qrcode-generator');

let loading: Promise<QrFactory> | null = null;

export function loadQrEncoder(): Promise<QrFactory> {
  // The package types declare `export =`, while its ESM build exports a
  // default and a named `qrcode`. Accept whichever shape the bundler hands over.
  loading ??= import('qrcode-generator').then((module) => {
    const shaped = module as unknown as { default?: QrFactory; qrcode?: QrFactory };
    return shaped.default ?? shaped.qrcode ?? (module as unknown as QrFactory);
  });
  return loading;
}

export function shortUrl(slug: string): string {
  return `https://daffa.me/${slug}`;
}

export interface QrMatrix {
  size: number;
  /** One unit square per dark module, for a viewBox of 0 0 size size. */
  path: string;
  isDark: (row: number, col: number) => boolean;
}

export function buildQr(encoder: QrFactory, text: string): QrMatrix {
  const qr = encoder(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { size, path, isDark: (row, col) => qr.isDark(row, col) };
}

// Downloaded files cannot use CSS variables, so the colors come from the shared
// token values rather than being written out here.
const DARK = COLORS['--ink'];
const LIGHT = COLORS['--qr-bg'];
const QUIET = 4;

export function qrSvgFile(matrix: QrMatrix): string {
  const span = matrix.size + QUIET * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-${QUIET} -${QUIET} ${span} ${span}" ` +
    `width="1024" height="1024" shape-rendering="crispEdges">` +
    `<rect x="-${QUIET}" y="-${QUIET}" width="${span}" height="${span}" fill="${LIGHT}"/>` +
    `<path d="${matrix.path}" fill="${DARK}"/></svg>`
  );
}

export function qrPngDataUrl(matrix: QrMatrix, scale = 16): string {
  const size = (matrix.size + QUIET * 2) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available.');
  context.fillStyle = LIGHT;
  context.fillRect(0, 0, size, size);
  context.fillStyle = DARK;
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (matrix.isDark(row, col)) {
        context.fillRect((col + QUIET) * scale, (row + QUIET) * scale, scale, scale);
      }
    }
  }
  return canvas.toDataURL('image/png');
}

export function downloadFile(href: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function qrFileName(slug: string, kind: 'png' | 'svg'): string {
  return `daffa-me-${slug}.${kind}`;
}

/**
 * Saves the code as a 1024 px SVG or a PNG with a 4 module quiet zone, named
 * like daffa-me-cv.png. Returns the file name for the confirmation toast.
 */
export function downloadQr(slug: string, kind: 'png' | 'svg', matrix: QrMatrix): string {
  const name = qrFileName(slug, kind);
  if (kind === 'svg') {
    const url = URL.createObjectURL(new Blob([qrSvgFile(matrix)], { type: 'image/svg+xml' }));
    downloadFile(url, name);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    downloadFile(qrPngDataUrl(matrix), name);
  }
  return name;
}
