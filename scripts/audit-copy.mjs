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
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
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
  ['429 link limit', pages.renderLinkLimit('r9pd3v')],
  ['429 public capacity', pages.renderBusy('h2mc8e')],
  ['429 attempt limit', pages.renderAttemptLimit('wp-login.php')],
  ['200 public link notice', pages.renderInterstitial('x7kq2m', 'https://docs.google.com/forms/d/e/1FAIpQLSd3kR9vQx/viewform')],
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

// Pass three: dashboard UI text. Parsed with the TypeScript compiler so only
// real copy is checked: JSX text, and string or template literals that read
// as prose (they contain a space). Code, class names and URLs are not prose.
const ts = (await import('typescript')).default;
const FIRST_PERSON = /\b(I|me|my|mine|we|us|our|ours)\b/;
const FIRST_PERSON_LOWER = /\b(me|my|mine|we|us|our|ours)\b/i;
let uiStrings = 0;

function checkCopy(text, where) {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed || !/[A-Za-z]/.test(trimmed)) return;
  uiStrings += 1;
  if (trimmed.includes(';')) problems.push(`${where} contains a semicolon: "${trimmed}"`);
  // Domains and paths are not words: the "me" in daffa.me is a TLD, not a pronoun.
  const words = trimmed.replace(/\S*\w\.\w\S*/g, ' ');
  if (FIRST_PERSON.test(words) || FIRST_PERSON_LOWER.test(words)) {
    problems.push(`${where} uses a first person pronoun: "${trimmed}"`);
  }
}

let clientFiles = [];
try {
  clientFiles = (await sourceFiles(path.join(ROOT, 'apps/dashboard/src/client'))).filter(
    (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
  );
} catch {
  clientFiles = [];
}

for (const file of clientFiles) {
  const body = await readFile(file, 'utf8');
  const source = ts.createSourceFile(file, body, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const relative = path.relative(ROOT, file);
  const visit = (node) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const where = `${relative}:${line}`;
    if (ts.isJsxText(node)) {
      checkCopy(node.text, where);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
      !ts.isImportDeclaration(node.parent) &&
      /\s/.test(node.text)
    ) {
      checkCopy(node.text, where);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (problems.length > 0) {
  console.error('Copy audit failed:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`Copy audit passed. Checked ${RENDERED.length} rendered pages, all source files, and ${uiStrings} dashboard UI strings.`);
console.log('No em dashes, no en dashes, no semicolons in UI text, no first person pronouns.');
