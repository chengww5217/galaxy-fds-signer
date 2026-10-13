# galaxy-fds-signer

[![npm version](https://img.shields.io/npm/v/galaxy-fds-signer.svg)](https://www.npmjs.com/package/galaxy-fds-signer)
[![CI](https://github.com/chengww5217/galaxy-fds-signer/actions/workflows/ci.yml/badge.svg)](https://github.com/chengww5217/galaxy-fds-signer/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

Galaxy-V2 request signing and pre-signed URLs for [Xiaomi Galaxy FDS](https://github.com/XiaoMi/galaxy-fds-sdk-java) (File Data Storage). It returns plain request objects (`{ url, method, headers }`) that you can pass directly to `fetch`.

- Runs on Node.js, Cloudflare Workers, Vercel Edge, Deno and Bun. It uses only Web-standard APIs (`crypto.subtle`, `TextEncoder`, `URL`), with no `node:*` or `Buffer`.
- Signatures match the official `galaxy-fds-sdk-java` byte-for-byte, checked by golden tests.
- No runtime dependencies. Ships ESM, CommonJS and TypeScript declarations.

> This package only signs requests; it does not perform any network I/O itself. The access secret must stay on the server or in an edge function. Hand out signed requests or pre-signed URLs to browsers, never the secret. Deciding who may sign what is the caller's responsibility.

## Installation

```bash
npm install galaxy-fds-signer
```

Requires Node.js >= 20 (global Web Crypto), or any runtime with `crypto.subtle`.

## Usage

```ts
import { createSigner } from 'galaxy-fds-signer';

const signer = createSigner({
  accessId: env.FDS_ACCESS_ID,
  accessSecret: env.FDS_ACCESS_SECRET,
  endpoint: 'cnbj1.fds.api.xiaomi.com', // or baseUri: 'https://…/'
});
```

### Signed requests (`Authorization` header)

```ts
const req = await signer.signRequest({
  method: 'PUT',
  bucket: 'my-bucket',
  object: 'photos/cat.png',
  headers: { 'content-type': 'image/png' },
});
// req = {
//   url: 'https://cnbj1.fds.api.xiaomi.com/my-bucket/photos/cat.png',
//   method: 'PUT',
//   headers: { 'content-type': 'image/png', 'x-xiaomi-date': '…', authorization: 'Galaxy-V2 …' },
// }

await fetch(req.url, { ...req, body: file });
```

`signRequest` adds an `x-xiaomi-date` header automatically, because browsers forbid setting `Date` from script. Send every header in `req.headers` exactly as returned, since they are all part of the signature.

### Pre-signed URLs

```ts
const { url, method, headers, expiresAt } = await signer.presign({
  method: 'PUT',
  bucket: 'my-bucket',
  object: 'uploads/report.pdf',
  expiresIn: 600, // seconds; default 900. Or `expires: Date | epoch ms`
  headers: { 'content-type': 'application/pdf' }, // optional, becomes part of the signature
});

// In the browser:
await fetch(url, { method, headers, body: file });
```

`headers` lists exactly what the client has to send for the signature to verify. It is empty unless you signed some.

### Edge function example (Cloudflare Workers / Vercel Edge)

```ts
import { createSigner } from 'galaxy-fds-signer';

export default {
  async fetch(request: Request, env: Env) {
    const signer = createSigner({
      accessId: env.FDS_ACCESS_ID,
      accessSecret: env.FDS_ACCESS_SECRET,
      endpoint: 'cnbj1.fds.api.xiaomi.com',
    });
    const { name } = await request.json<{ name: string }>();
    // Authorize the caller and validate `name` here.
    return Response.json(await signer.presign({ method: 'PUT', bucket: 'uploads', object: name }));
  },
};
```

The result is plain JSON, so the browser can pass it straight to `fetch`.

### More targets

```ts
// Sub-resources are signed and URL-encoded for you
await signer.signRequest({ method: 'PUT', bucket, object, subResources: { uploadId, partNumber: 1 } });
await signer.presign({ bucket, object, subResources: ['acl'] });

// Extra query parameters are sent but not signed (e.g. listing objects)
await signer.signRequest({ bucket, query: { prefix: 'photos/', maxKeys: 100 } });

// CDN endpoint
await signer.presign({ bucket, object, cdn: true });

// An explicit URL
await signer.signRequest({ method: 'DELETE', url: 'https://cnbj1.fds.api.xiaomi.com/b/o' });

// One-shot helpers
import { signRequest, presign } from 'galaxy-fds-signer';
await presign(options, { bucket, object });
```

## API

| Export | Description |
| --- | --- |
| `createSigner(options)` | Returns `{ accessId, signRequest, presign }`. The secret is held in a closure and never exposed. Configuration errors throw synchronously. |
| `signRequest(options, input)` / `presign(options, input)` | One-shot forms of the methods above. |
| `HttpMethod`, `SignAlgorithm`, `SubResource`, `XiaomiHeader` | Constant maps with literal union types. |
| `GalaxyFDSSignerError` | The only error type thrown or rejected. The underlying error, if any, is in `cause`. |

`SignerOptions`: `accessId`, `accessSecret`, `algorithm` (`HmacSHA1` default, `HmacSHA256`, `HmacMD5`). For addressing, use either `endpoint` / `regionName` / `cdnEndpoint` / `enableHttps`, or explicit `baseUri` / `cdnBaseUri`. Endpoints on `*.mi-fds.com` use virtual-hosted addressing (`{bucket}.{endpoint}`). In that mode, bucket names must be valid DNS labels.

`SignRequestInput`: `method`, then either `bucket` / `object` / `subResources` / `cdn` or `url`, plus `query`, `headers`, and `date`.

`PresignInput`: `method`, `bucket`, `object`, `subResources`, `cdn`, `expires` or `expiresIn`, and `headers`.

Header names are case-insensitive, and you can pass them as a plain object, a `Headers` instance or `[name, value]` pairs. Returned headers use lower-case names.

## How signing works

The Galaxy-V2 signature is an HMAC over:

```
{METHOD}\n{content-md5}\n{content-type}\n{date, or Expires for pre-signed URLs}\n
{sorted x-xiaomi-* headers as name:value\n}{decoded path}{?sorted sub-resources}
```

Only the recognized sub-resources (`acl`, `quota`, `uploads`, `partNumber`, `uploadId`, `storageAccessToken`, `compression`, `metadata`) are part of the signature. When `x-xiaomi-date` is present, the `date` line is left empty. The path and query are percent-decoded the same way `java.net.URI` decodes them.

## Development

```bash
npm install
npm run typecheck   # also checks src against Web APIs only (tsconfig.web.json)
npm run lint
npm test            # includes Vercel Edge (edge-runtime) and Cloudflare (workerd) runs
npm run build
```

The expected values in `test/golden.test.ts` and `test/api.test.ts` were produced by the official `galaxy-fds-sdk-java` (3.0.37, and 3.0.48 for the original cases). They are hard-coded in the tests. If you change signing behavior, regenerate the affected values from the Java SDK.

## License

[Apache License 2.0](./LICENSE). This is an independent port, not an official Xiaomi release.
