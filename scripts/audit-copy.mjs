import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, importTs } from './bundle.mjs';

/**
 * Copy rules from the design brief: no em dashes, no en dashes, no semicolons
 * in any UI text. The middle dot is the separator the design uses instead.
 *
 * Two passes. First the rendered visitor pages, checked on visible text only.
 * Then every source file, checked for dash characters anywhere, since neither
 * belongs in code either. Semicolons are only checked in rendered text, because
 * they are ordinary syntax in TypeScript and CSS.
 */
const EM_DASH = '—';
const EN_DASH = '–';

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

function visibleText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, (head) => {
      const title = /<title>([\s\S]*?)<\/title>/i.exec(head);
      return title ? ` ${title[1]} ` : ' ';
    })
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, ' ')
    .trim();
}

async function sourceFiles(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await sourceFiles(full, out);
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const problems = [];

// Pass one: rendered visitor pages.
const pages = await importTs('apps/redirector/src/pages.ts');
const RENDERED = [
  ['404 not found', pages.renderNotFound('portofolio')],
  ['410 gone', pages.renderGone('k7m2qx')],
  ['503 unavailable', pages.renderUnavailable('cv')],
];

for (const [name, html] of RENDERED) {
  const text = visibleText(html);
  if (text.includes(EM_DASH)) problems.push(`${name}: visible text contains an em dash`);
  if (text.includes(EN_DASH)) problems.push(`${name}: visible text contains an en dash`);
  if (text.includes(';')) problems.push(`${name}: visible text contains a semicolon`);
}

// Pass two: dash characters anywhere in source.
for (const dir of ['shared', 'apps', 'scripts']) {
  let files = [];
  try {
    files = await sourceFiles(path.join(ROOT, dir));
  } catch {
    continue; // the directory does not exist yet
  }
  for (const file of files) {
    const body = await readFile(file, 'utf8');
    const relative = path.relative(ROOT, file);
    body.split(/\r?\n/).forEach((line, index) => {
      if (line.includes(EM_DASH)) problems.push(`${relative}:${index + 1} contains an em dash`);
      if (line.includes(EN_DASH)) problems.push(`${relative}:${index + 1} contains an en dash`);
    });
  }
}

if (problems.length > 0) {
  console.error('Copy audit failed:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`Copy audit passed. Checked ${RENDERED.length} rendered pages and all source files.`);
console.log('No em dashes, no en dashes, no semicolons in UI text.');
