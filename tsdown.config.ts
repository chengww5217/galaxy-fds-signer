import { defineConfig } from 'tsdown';

/**
 * Bundles the library and its type declarations in a single pass.
 *
 * The package is ESM-only, so `tsdown` emits just `dist/index.js` and
 * `dist/index.d.ts`. After building it validates the packaged result with
 * `publint` (exports/main/files wiring) and `attw` (declaration resolution in
 * every TypeScript resolution mode).
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  // Web-standard APIs only (no node:* imports) so one bundle serves Node,
  // Cloudflare Workers, Vercel Edge, Deno, Bun and browsers.
  platform: 'neutral',
  target: 'es2022',
  // Sourcemaps are intentionally not published: the bundle is unminified, so
  // they only inflate the tarball.
  sourcemap: false,
  minify: false,
  publint: { strict: true },
  // ESM-only by design: CJS consumers must use `import()` / `require(esm)`.
  // The `esm-only` profile validates that instead of flagging the missing CJS
  // entry as a problem.
  attw: { profile: 'esm-only' },
});
