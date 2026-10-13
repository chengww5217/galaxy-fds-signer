# Contributing

Thanks for your interest in improving `galaxy-fds-signer`.

## Getting started

```bash
npm install
npm test
```

The published package runs on Node.js >= 18, but the development toolchain
(vitest 5) requires Node.js >= 22 — use Node 22/24 locally, matching CI.

## Guidelines

- The signing logic must stay byte-for-byte compatible with the official
  `galaxy-fds-sdk-java`. Any change touching `src/auth/` must keep the golden
  parity tests passing (`npm test`).
- If you change signing behavior, re-derive the affected expected values from
  the Java SDK and update them inline in `test/golden.test.ts` /
  `test/utils.test.ts` together with your change.
- Run `npm run typecheck` and `npm run lint` before opening a pull request.
- Keep the package dependency-free at runtime; use Node.js built-ins only.
- Use `undefined`, not `null`, for absent values in the library's own types: mark
  optional properties and parameters with `?`, and normalize any `null` at the
  boundary immediately.
- Follow Conventional Commits for commit messages (e.g. `feat:`, `fix:`,
  `test:`, `docs:`, `chore:`).

## Reporting issues

Please include the library version, Node.js version, a minimal reproduction, and
the expected vs. actual signature or URI when reporting a signing discrepancy.
