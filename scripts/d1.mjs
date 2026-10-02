import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './bundle.mjs';

/**
 * Runs SQL against the local D1 database both Workers share, and returns one
 * result set per statement. The SQL always goes through a temporary --file,
 * because `wrangler d1 execute --command` would need shell quoting that
 * differs between Windows and POSIX. Never touches the remote database.
 */
export async function d1Local(sql) {
  const dir = await mkdtemp(path.join(tmpdir(), 'daffa-d1-'));
  const file = path.join(dir, 'query.sql');
  try {
    await writeFile(file, sql, 'utf8');
    const run = spawnSync(
      'npx',
      [
        'wrangler', 'd1', 'execute', 'daffa-links', '--local',
        '--persist-to', '.wrangler-state',
        '-c', 'apps/redirector/wrangler.jsonc',
        '--json', '--yes', '--file', `"${file}"`,
      ],
      { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 16 * 1024 * 1024 },
    );
    if (run.status !== 0) {
      throw new Error(
        `wrangler d1 execute failed. Run \`npm run migrate:local\` first.\n${run.stdout}\n${run.stderr}`,
      );
    }
    return JSON.parse(run.stdout.slice(run.stdout.indexOf('[')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
