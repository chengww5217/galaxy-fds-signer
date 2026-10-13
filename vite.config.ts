import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

/**
 * Vitest configuration only. The library itself is bundled by `tsdown`; Vite is
 * kept for the test runner and for `test/runtimes.test.ts`, which bundles the
 * sources in-memory to run them inside edge runtimes.
 */
export default defineConfig({
  test: {
    // Two projects, so the live suite cannot be reached by accident: `npm test`
    // runs `unit` only, and `test/integration` (which talks to a real bucket)
    // needs `--project integration` plus a build. See test/integration/README.md.
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'test/integration/**'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          // Nine cases against a real endpoint, with deliberately small payloads:
          // this only guards against a hang.
          testTimeout: 30_000,
        },
      },
    ],
  },
});
