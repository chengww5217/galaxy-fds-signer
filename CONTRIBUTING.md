# Contributing

Thanks for your interest in improving `galaxy-fds-signer`.

## Getting started

```bash
npm install
npm test
```

The published package supports Node.js >= 22, and so does the development
toolchain: vitest 5 requires Node.js >= 22.12. Use Node 22/24 locally, matching
CI.

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

## Releasing

Releases are cut from `main` with a single command:

```bash
npm run release -- current   # first release: publish package.json as-is (0.1.0)
npm run release -- patch     # later releases: 0.1.0 -> 0.1.1 (or minor / major)
```

`current` skips the version bump; `patch`/`minor`/`major` (or an explicit
version such as `1.0.0`) bump it. The default is `patch`.

It bumps `package.json` when needed, commits (`chore: release vX.Y.Z`), tags,
pushes, and opens a GitHub Release. `.github/workflows/release.yml` then runs
`npm publish` on `release: published`, so no manual publish step is needed. The
version in `package.json` must match the tag; the workflow verifies this.

By hand, if the script is unavailable:

```bash
npm version patch -m "chore: release v%s"   # or edit package.json and commit
git push --follow-tags
gh release create vX.Y.Z --generate-notes
```

The very first version cannot be published by CI: npm requires the package to
exist before a trusted publisher can be configured for it (npm/cli#8544), so
`0.1.0` was published manually (`npm login && npm publish`) and the workflow
skips it via the published-version check. On npmjs.com → the package →
Settings → Trusted publishing → GitHub Actions, point a trusted publisher at
this repository and `release.yml`, and make sure a publish succeeds within 2
days: an unvalidated configuration expires.

## Reporting issues

Please include the library version, Node.js version, a minimal reproduction, and
the expected vs. actual signature or URI when reporting a signing discrepancy.
