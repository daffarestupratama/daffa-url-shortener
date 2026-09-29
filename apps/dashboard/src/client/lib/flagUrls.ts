/**
 * Every 3x2 flag from country-flag-icons, as a URL to its own static file.
 *
 * `no-inline` matters: without it Vite inlines each SVG under 4 KB as a data
 * URI, which would put all 265 flags into the JavaScript. With it, the bundle
 * only carries this code to URL table, and the browser fetches a flag file the
 * first time a country with that flag is shown. The files are served from the
 * dashboard's own origin, never from a CDN.
 */
const modules = import.meta.glob<string>('@flags/*.svg', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
});

export const FLAG_URLS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(modules).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -4), url]),
);
