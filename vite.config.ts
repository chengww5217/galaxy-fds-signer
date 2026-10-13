import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

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
    sourcemap: true,
    target: 'es2022',
    minify: false,
  },
  plugins: [
    dts({
      include: ['src'],
      entryRoot: 'src',
    }),
  ],
});
