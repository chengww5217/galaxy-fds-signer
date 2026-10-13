#!/usr/bin/env node
/**
 * Installs the packed tarball into a throwaway project and uses it the way a
 * consumer would: `import` (ESM) and `require` (Node's require(esm)), both
 * through the package's `exports`.
 *
 * publint and attw (run by `npm run build`) check the package metadata and the
 * declarations; this checks that the published files actually load and sign.
 * Run it after `npm run build`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const consumer = mkdtempSync(join(tmpdir(), 'galaxy-fds-signer-smoke-'));
try {
  // npm <= 11 prints an array of results; npm 12 an object keyed by package name.
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', consumer], root));
  const { filename } = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  writeFileSync(join(consumer, 'package.json'), '{ "private": true }\n');
  run('npm', ['install', '--no-audit', '--no-fund', `./${filename}`], consumer);

  const probe = (api) => `
    const s = ${api}.createSigner({
      accessId: 'id',
      accessSecret: 'secret',
      endpoint: 'cnbj1.fds.api.xiaomi.com',
    });
    s.signRequest({ bucket: 'b', object: 'o' }).then((r) => {
      if (!r.headers.authorization.startsWith('Galaxy-V2 id:')) throw new Error('bad signature');
    });
  `;
  run(
    'node',
    ['--input-type=module', '-e', `import * as m from 'galaxy-fds-signer';${probe('m')}`],
    consumer,
  );
  run('node', ['-e', `const m = require('galaxy-fds-signer');${probe('m')}`], consumer);
  console.log(`${filename}: import and require(esm) both work`);
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
