import { shortUrl } from './qr';

/** Copies https://daffa.me/<slug> and confirms with the design's toast copy. */
export async function copyShortLink(slug: string, toast: (message: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(shortUrl(slug));
    toast(`daffa.me/${slug} copied to clipboard`);
  } catch {
    toast('The link could not be copied. Copy it from the address shown instead.');
  }
}
