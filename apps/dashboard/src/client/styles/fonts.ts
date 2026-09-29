/**
 * Self hosted fonts, only the weights the design uses. Each file declares the
 * latin and latin-ext subsets with unicode-range, so the browser only fetches
 * latin-ext when a page actually contains those characters. Vite copies the
 * woff2 files into the build. Nothing is requested from Google Fonts.
 */
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/500.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import '@fontsource/atkinson-hyperlegible-next/800.css';
import '@fontsource/atkinson-hyperlegible-mono/400.css';
import '@fontsource/atkinson-hyperlegible-mono/500.css';
import '@fontsource/atkinson-hyperlegible-mono/700.css';
