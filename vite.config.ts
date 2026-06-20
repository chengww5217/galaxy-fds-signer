import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'GalaxyFDS',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    // Keep Node built-ins external; this SDK has zero runtime dependencies.
    rollupOptions: {
      external: [/^node:/],
    },
    sourcemap: true,
    target: 'node18',
    minify: false,
  },
  plugins: [
    dts({
      include: ['src'],
      rollupTypes: true,
    }),
  ],
});
