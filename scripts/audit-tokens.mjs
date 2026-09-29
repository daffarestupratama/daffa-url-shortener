import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './bundle.mjs';

/**
 * Every color in the dashboard client must come from a token, so a dark
 * palette can be added later by redefining variables only. This scans the
 * client source for literal colors and fails on any outside styles/tokens.css.
 *
 * It reads source, not the build: third party code in the bundle carries
 * unrelated literals (the qrcode-generator HTML helpers contain #000000), and
 * what matters is that our own code never hardcodes a color. Test files are
 * skipped because they check token values on purpose.
 */

const CLIENT = path.join(ROOT, 'apps/dashboard/src/client');
const ALLOWED = path.join(CLIENT, 'styles/tokens.css');

const PATTERNS = [
  ['hex color', /#[0-9a-fA-F]{3,8}\b/g],
  ['rgb() color', /\brgba?\(/g],
  ['hsl() color', /\bhsla?\(/g],
];

async function files(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await files(full, out);
    else if (/\.(css|ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const problems = [];
const scanned = await files(CLIENT);

for (const file of scanned) {
  if (file === ALLOWED) continue;
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const [label, pattern] of PATTERNS) {
      for (const match of line.matchAll(pattern)) {
        problems.push(`${path.relative(ROOT, file)}:${index + 1}  ${label} ${match[0]}`);
      }
    }
  });
}

if (problems.length > 0) {
  console.error('Token audit failed. Use a variable from styles/tokens.css instead:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`Token audit passed. ${scanned.length - 1} client source files, no color literals outside tokens.css.`);
