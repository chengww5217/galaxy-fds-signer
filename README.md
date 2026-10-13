# galaxy-fds-signer

[![npm version](https://img.shields.io/npm/v/galaxy-fds-signer.svg)](https://www.npmjs.com/package/galaxy-fds-signer)
[![CI](https://github.com/chengww5217/galaxy-fds-signer/actions/workflows/ci.yml/badge.svg)](https://github.com/chengww5217/galaxy-fds-signer/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

Galaxy-V2 request signing and pre-signed URLs for [Xiaomi Galaxy FDS](https://github.com/XiaoMi/galaxy-fds-sdk-java) (File Data Storage). It returns plain request objects (`{ url, method, headers }`) that you can pass directly to `fetch`.

- Runs on Node.js, Cloudflare Workers, Vercel Edge, Deno and Bun. It uses only Web-standard APIs, with no `node:*` or `Buffer`.
- Covers all 57 operations of the official `galaxy-fds-sdk-java` client. URLs and signatures match the Java SDK byte-for-byte, checked by tests.
- No runtime dependencies. Ships ESM, CommonJS and TypeScript declarations.

> This package only signs requests; it does not perform any network I/O itself. The access secret must stay on the server or in an edge function. Hand out signed requests or pre-signed URLs to browsers, never the secret.

## Installation

```bash
npm install galaxy-fds-signer
```

Requires Node.js >= 20, or any runtime with `crypto.subtle`.

## Quick start

```ts
import { createSigner } from 'galaxy-fds-signer';

const signer = createSigner({ accessId, accessSecret, endpoint: 'cnbj1.fds.api.xiaomi.com' });

const req = await signer.signRequest({ method: 'PUT', bucket: 'my-bucket', object: 'cat.png' });
await fetch(req.url, { ...req, body: file });
```

Every failure is a `GalaxyFDSSignerError` with a stable `code` (e.g. `INVALID_BUCKET`), a `kind` (`config`, `input` or `runtime`) and the offending `field`. Catch it in your handler: `input` errors are caused by the request and can be returned to the client as JSON (`Response.json(err)` sends `{ name, code, kind, field, message }`), while `config` and `runtime` errors belong in your logs. See [Errors](./docs/api.md#errors).

## Documentation

- [API reference](./docs/api.md): `createSigner`, `signRequest`, `presign`, every option, return value and error, and how signing works
- [Operations](./docs/operations.md): all 57 FDS operations (buckets, objects, ACL, multipart, lifecycle, CORS, …) and the `signRequest` input for each
- [Pre-signed URLs](./docs/presign.md): what is signed, expiration, the 20 pre-signable operations, edge-function and browser usage, and multipart upload from the browser

## Development

```bash
npm install
npm run typecheck   # also checks src against Web APIs only (tsconfig.web.json)
npm run lint
npm test            # includes Vercel Edge (edge-runtime) and Cloudflare (workerd) runs
npm run build
npm run docs        # regenerates the tables in docs/ from test/fixtures/operations.json
```

The expected values in `test/golden.test.ts`, `test/api.test.ts` and `test/fixtures/operations.json` were produced by the official `galaxy-fds-sdk-java` (3.0.37, and 3.0.48 for the original cases). If you change signing behavior, regenerate the affected values from the Java SDK. `test/docs.test.ts` fails if the generated docs are out of date.

## License

[Apache License 2.0](./LICENSE). This is an independent port, not an official Xiaomi release.
