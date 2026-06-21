# Contributing

Thanks for your interest in improving `galaxy-fds-sdk-nodejs`.

## Getting started

```bash
npm install
npm test
```

## Guidelines

- The signing logic must stay byte-for-byte compatible with the official
  `galaxy-fds-sdk-java`. Any change touching `src/auth/` must keep the golden
  parity tests passing (`npm test`).
- If you change signing behavior, re-derive the affected expected values from
  the Java SDK and update them inline in `test/golden.test.ts` /
  `test/utils.test.ts` together with your change.
- Run `npm run typecheck` and `npm run lint` before opening a pull request.
- Keep the package dependency-free at runtime; use Node.js built-ins only.
- Follow Conventional Commits for commit messages (e.g. `feat:`, `fix:`,
  `test:`, `docs:`, `chore:`).

## Reporting issues

Please include the SDK version, Node.js version, a minimal reproduction, and
the expected vs. actual signature or URI when reporting a signing discrepancy.
