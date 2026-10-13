/**
 * Runs the bundled library inside real non-Node runtimes:
 *
 * - Vercel Edge, via `@edge-runtime/vm` (the VM Vercel's Edge runtime uses);
 * - Cloudflare Workers, via Miniflare / workerd (without `nodejs_compat`).
 *
 * Neither exposes `Buffer`, `process` or `node:*` modules, so this fails if
 * the library accidentally depends on Node.js. The same probe also runs in
 * Node and all three results must be identical.
 */
import { resolve } from 'node:path';

import { EdgeVM } from '@edge-runtime/vm';
import { Miniflare } from 'miniflare';
import { build } from 'tsdown';
import { beforeAll, describe, expect, it } from 'vitest';

import * as lib from '../src/index.js';

type Lib = typeof lib;

/**
 * Exercises signing and pre-signing with every algorithm. Must be
 * self-contained: it is serialized and evaluated inside each runtime.
 */
async function probe(api: Lib): Promise<Record<string, unknown>> {
  const options = {
    accessId: 'AKIDEXAMPLEACCESSID',
    accessSecret: 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
    endpoint: 'cnbj1.fds.api.xiaomi.com',
  };
  const date = new Date('1994-11-06T08:49:37Z');
  const out: Record<string, unknown> = {};
  for (const algorithm of Object.values(api.SignAlgorithm)) {
    out[algorithm] = await api.signRequest(
      { ...options, algorithm },
      {
        method: 'PUT',
        bucket: 'my-bucket',
        object: 'dir/中文 object',
        subResources: { uploadId: 'a/b', partNumber: 2 },
        headers: { 'Content-Type': 'image/png', 'X-Xiaomi-Meta-Foo': 'a' },
        date,
      },
    );
  }
  out.presign = await api.createSigner(options).presign({
    method: 'PUT',
    bucket: 'my-bucket',
    object: 'path/中文.txt',
    subResources: { uploadId: 'x y', partNumber: 3 },
    headers: { 'content-type': 'text/plain' },
    expires: 4102444800000,
  });
  return out;
}

let esm = '';
let iife = '';
let expected: Record<string, unknown>;

beforeAll(async () => {
  // Bundle with the real tsdown.config.ts, so the ESM tested here is the one
  // that ships in dist/. Declarations and the publint/attw checks are left to
  // `npm run build`; nothing is written, and dist/ is left alone. The IIFE is
  // only for @edge-runtime/vm, which evaluates scripts rather than modules.
  const { bundles } = await build({
    config: resolve(import.meta.dirname, '../tsdown.config.ts'),
    write: false,
    clean: false,
    dts: false,
    publint: false,
    attw: false,
    logLevel: 'silent',
    format: ['esm', 'iife'],
    globalName: 'GalaxyFDS',
  });
  const code = (format: string) => {
    const chunk = bundles
      .filter((b) => b.config.format === format)
      .flatMap((b) => b.chunks)
      .find((c) => c.type === 'chunk');
    if (chunk?.type !== 'chunk') {
      throw new Error(`tsdown emitted no ${format} chunk`);
    }
    return chunk.code;
  };
  esm = code('es');
  iife = code('iife');
  expected = await probe(lib);
}, 60_000);

describe('runtime portability', () => {
  it('bundles without any node: imports', () => {
    expect(esm).not.toMatch(/from\s*['"]node:/);
    expect(esm).not.toMatch(/\bBuffer\b/);
  });

  it('produces identical results on Vercel Edge (edge-runtime)', async () => {
    const vm = new EdgeVM();
    expect(vm.evaluate('typeof Buffer')).toBe('undefined');
    vm.evaluate(iife);
    const result = await vm.evaluate(`(${probe.toString()})(GalaxyFDS)`);
    expect(JSON.parse(JSON.stringify(result))).toEqual(expected);
  });

  it('produces identical results on Cloudflare Workers (workerd)', async () => {
    // Miniflare 5 takes the compiled Worker manifest directly: module names are
    // the map keys, so the worker's `./index.js` import resolves within the
    // manifest. The flat v4 `modules: [...]` shorthand is gone.
    const mf = new Miniflare({
      workers: [
        {
          config: {
            name: 'worker',
            compatibilityDate: '2026-01-01',
            manifest: {
              mainModule: 'worker.js',
              modules: {
                'worker.js': { type: 'esm', contents: WORKER },
                'index.js': { type: 'esm', contents: esm },
              },
            },
          },
        },
      ],
    });
    try {
      const response = await mf.dispatchFetch('http://localhost/');
      const body = (await response.json()) as { buffer: string; result: Record<string, unknown> };
      expect(body.buffer).toBe('undefined');
      expect(body.result).toEqual(expected);
    } finally {
      await mf.dispose();
    }
  }, 60_000);
});

const WORKER = `
import * as api from './index.js';
const probe = ${probe.toString()};
export default {
  async fetch() {
    try {
      return Response.json({ buffer: typeof Buffer, result: await probe(api) });
    } catch (e) {
      return new Response(String(e && e.stack || e), { status: 500 });
    }
  },
};
`;
