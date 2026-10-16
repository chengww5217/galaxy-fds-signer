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
  the Java SDK and update them inline in `test/golden.test.ts`,
  `test/api.test.ts` and `test/utils.test.ts` together with your change.
- Run `npm run verify` before opening a pull request: typecheck, lint, tests,
  the build (with publint and attw) and a smoke test of the packed tarball.
  `lint` is ESLint plus `prettier --check`, and `npm run fix` applies both sets
  of fixes: ESLint first, Prettier last, so the final layout is always
  Prettier's. `.prettierignore` keeps Prettier away from the generated docs
  tables and `test/fixtures/`.
- Live requests against a real bucket live in `test/integration/` and are
  excluded from `npm test`, so a full `npm test` never touches the network. Run
  them deliberately with `npm run test:integration` and `FDS_*` credentials;
  `test/integration/README.md` has the exact variables and the safety notes.
- Keep the package dependency-free at runtime, and use Web-standard APIs only
  in `src/` (no `node:*` imports, `Buffer`, or the `process` global):
  `tsconfig.web.json` and `test/runtimes.test.ts` enforce it. The single
  deliberate exception is the optional `node:crypto` fast path in
  `src/auth/crypto.ts`: it reaches `process.getBuiltinModule` through
  `globalThis` and falls back to Web Crypto wherever that is unavailable.
- Use `undefined`, not `null`, for absent values in the library's own types: mark
  optional properties and parameters with `?`, and normalize any `null` at the
  boundary immediately.
- Follow Conventional Commits for commit messages (e.g. `feat:`, `fix:`,
  `test:`, `docs:`, `chore:`).

## Releasing

Releases are cut from `main` with a single command:

```bash
npm run release -- current   # first release: package.json as-is (0.1.0)
npm run release -- patch     # later releases: 0.1.0 -> 0.1.1 (or minor / major)
```

`current` skips the version bump; `patch`/`minor`/`major` (or an explicit
version such as `1.0.0`) bump it. There is no default: on `0.x`, a breaking
change (`feat!:` / `BREAKING CHANGE:`) is a `minor` bump.

It first runs `npm ci` and `npm run verify`, so a failing build is never
tagged. It then bumps `package.json` when needed, commits (`chore: release vX.Y.Z`), tags,
pushes, and opens a GitHub Release. `.github/workflows/release.yml` then runs
`npm publish` on `release: published`, so no manual publish step is needed. The
version in `package.json` must match the tag; the workflow verifies this.

By hand, if the script is unavailable:

```bash
npm version patch -m "chore: release v%s"   # or edit package.json and commit
git push --follow-tags
gh release create vX.Y.Z --generate-notes
```

### First release

The package is not on npm yet, and the first version cannot be published by
CI: npm only allows a trusted publisher (OIDC) to be configured for a package
that already exists (npm/cli#8544). `npm run release -- current` handles this:
while the package is not on the registry, it runs `npm publish` from your
machine (after `npm ci` and `npm run verify`), then tags and creates the GitHub
Release; `release.yml` finds the version on the registry and skips it. Any
other mode refuses to run until then.

1. `npm login` (the account needs publish rights and 2FA).
2. `npm run release -- current`.
3. On npmjs.com → the package → Settings → Trusted publishing → GitHub Actions,
   add a trusted publisher for this repository and `release.yml`.

From then on every release is published by `release.yml` only. That first
version is published without a provenance attestation, since provenance needs
a CI identity; later ones get it automatically. If the run fails after
publishing, re-run `npm run release -- current`: it notices the version is
already on npm and only tags and releases it.

## Reporting issues

Please include the library version, Node.js version, a minimal reproduction, and
the expected vs. actual signature or URI when reporting a signing discrepancy.
