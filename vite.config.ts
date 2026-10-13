import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import dts from 'vite-plugin-dts';

/**
 * `bundleTypes` still writes the per-module declarations it bundled from (and
 * declaration maps), and the `require` entry needs CommonJS-flavoured
 * declarations — the package is `"type": "module"`, so `dist/index.d.ts` counts
 * as ESM and TypeScript reports the CJS build as masquerading as ESM under
 * `moduleResolution: node16`.
 *
 * So: drop everything but the four entry artifacts, then copy the single,
 * self-contained ESM declarations to `.d.cts` for the CJS entry.
 */
function finalizeDist(): Plugin {
  const keep = new Set(['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts']);

  return {
    name: 'galaxy-fds-signer:finalize-dist',
    apply: 'build',
    closeBundle() {
      const dist = resolve(import.meta.dirname, 'dist');

      for (const entry of readdirSync(dist, { withFileTypes: true })) {
        if (!keep.has(entry.name)) {
          rmSync(resolve(dist, entry.name), { recursive: true, force: true });
        }
      }

      const esmTypes = resolve(dist, 'index.d.ts');
      if (!existsSync(esmTypes)) {
        throw new Error('dist/index.d.ts was not emitted; check the dts plugin config');
      }
      copyFileSync(esmTypes, resolve(dist, 'index.d.cts'));
    },
  };
}

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'GalaxyFDS',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    // Web-standard APIs only (no node:* imports), so one bundle serves Node,
    // Cloudflare Workers, Vercel Edge, Deno, Bun and browsers.
    //
    // Sourcemaps are intentionally not published: the bundle is unminified, so
    // they only inflate the tarball.
    sourcemap: false,
    target: 'es2022',
    minify: false,
  },
  plugins: [
    dts({
      include: ['src'],
      entryRoot: 'src',
      // Inline every declaration into a single dist/index.d.ts. The package only
      // exposes the root entry point, so per-module .d.ts files would be
      // unreachable dead weight.
      bundleTypes: true,
    }),
    finalizeDist(),
  ],
});
