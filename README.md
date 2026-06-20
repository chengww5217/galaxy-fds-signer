# galaxy-fds-sdk-nodejs

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

A Node.js / TypeScript SDK for [Xiaomi Galaxy FDS](https://docs.api.xiaomi.com/) (File Data Storage), focused on **Galaxy-V2 request signing** and **pre-signed URI generation**.

It is a faithful port of the signing logic in the official [`galaxy-fds-sdk-java`](https://github.com/XiaoMi/galaxy-fds-sdk-java) (3.0.48). Signature output is verified byte-for-byte against the Java SDK via a golden test suite.

> Scope: this package implements **authentication signing** and **pre-signed URIs** only. It performs no network I/O and does not include object upload/download, bucket management, multipart upload, or Kerberos. Use the generated `Authorization` header or pre-signed URI with any HTTP client.

## Features

- Galaxy-V2 `Authorization` header generation (`HmacSHA1` / `HmacSHA256` / `HmacMD5`)
- Pre-signed URI and pre-signed CDN URI generation
- Zero runtime dependencies — uses only Node.js built-ins (`node:crypto`, `node:url`)
- Ships ESM, CommonJS, and TypeScript declarations
- Byte-for-byte parity with the Java SDK, enforced by tests

## Requirements

- Node.js >= 18

## Installation

```bash
npm install galaxy-fds-sdk-nodejs
```

## Usage

### Generate an `Authorization` header

```ts
import { GalaxyFDSClient, BasicFDSCredential, HttpMethod } from 'galaxy-fds-sdk-nodejs';

const client = new GalaxyFDSClient(
  new BasicFDSCredential('your-access-id', 'your-access-secret'),
);

const uri = 'http://files.fds.api.xiaomi.com/my-bucket/my-object';
const headers = { date: new Date().toUTCString() };

const authorization = client.getAuthorizationHeader(HttpMethod.GET, uri, headers);
// => "Galaxy-V2 your-access-id:<base64-signature>"

// Then issue the request with your HTTP client of choice:
// fetch(uri, { headers: { ...headers, authorization } })
```

### Generate a pre-signed URI

```ts
import { GalaxyFDSClient, BasicFDSCredential, HttpMethod, SubResource } from 'galaxy-fds-sdk-nodejs';

const client = new GalaxyFDSClient(
  new BasicFDSCredential('your-access-id', 'your-access-secret'),
);

// Valid for one hour from now.
const expiration = new Date(Date.now() + 60 * 60 * 1000);

// Download URL
const downloadUri = client.generatePresignedUri('my-bucket', 'my-object', expiration);

// Upload URL (PUT)
const uploadUri = client.generatePresignedUri('my-bucket', 'my-object', expiration, HttpMethod.PUT);

// Pre-signed URI targeting a sub-resource (e.g. ACL)
const aclUri = client.generatePresignedUri('my-bucket', 'my-object', expiration, HttpMethod.GET, [
  SubResource.ACL,
]);

// CDN variant
const cdnUri = client.generatePresignedCdnUri('my-bucket', 'my-object', expiration);
```

### Custom endpoints

```ts
const client = new GalaxyFDSClient(credential, {
  baseUri: 'https://my-bucket.mi-fds.com/',
  cdnBaseUri: 'http://cdn.fds.api.xiaomi.com/',
  // signAlgorithm: SignAlgorithm.HmacSHA256,
});
```

### Low-level signer

`Signer` exposes the same primitives as the Java `Signer` class if you need them directly:

```ts
import { Signer, HttpMethod, SignAlgorithm } from 'galaxy-fds-sdk-nodejs';

const signature = Signer.signToBase64(
  HttpMethod.GET,
  uri,
  headers,
  'your-access-secret',
  SignAlgorithm.HmacSHA1,
);
```

## API overview

| Export | Description |
| --- | --- |
| `GalaxyFDSClient` | High-level client for auth headers and pre-signed URIs |
| `BasicFDSCredential` | Static access-id / access-secret credential |
| `Signer` | Low-level signing primitives (`sign`, `signToBase64`, `getAuthorizationHeader`, `generatePresignedUri`) |
| `HttpMethod`, `SignAlgorithm`, `SubResource`, `XiaomiHeader` | Enums ported from the Java SDK |
| `GalaxyFDSClientException` | Error type thrown by the SDK |
| `calcMD5`, `urlEncode`, `getGMTDatetime`, `parseUri`, `parseUriParameters` | Signing utilities |

## How signing works

The Galaxy-V2 signature is an HMAC over a canonical string built from the request:

```
{HTTP-METHOD}\n
{content-md5}\n
{content-type}\n
{date or Expires}\n
{canonicalized x-xiaomi-* headers}
{canonicalized resource}
```

- If the URI carries an `Expires` query parameter (pre-signed URIs), that value is used in place of the date line.
- If an `x-xiaomi-date` header is present, the standard `date` line is left empty.
- Only the recognized sub-resources (`acl`, `quota`, `uploads`, `partNumber`, `uploadId`, `storageAccessToken`, `compression`, `metadata`) participate in the canonicalized resource.

The HMAC result is Base64-encoded and combined into `Galaxy-V2 {accessId}:{signature}`.

## Development

```bash
npm install
npm run build       # bundle ESM + CJS + .d.ts into dist/
npm test            # run the Vitest suite
npm run typecheck
npm run lint
```

### Regenerating golden fixtures

`test/fixtures/golden.json` is produced from the official Java SDK so that the
Node.js implementation can be checked for exact parity. To regenerate it you
need a JDK and the FDS jars plus their runtime dependencies (Guava,
commons-lang, commons-logging):

```bash
bash test/fixtures/java/generate.sh
```

Override the jar locations with the `FDS_LIB_DIR`, `GUAVA_JAR`,
`COMMONS_LANG_JAR`, and `COMMONS_LOGGING_JAR` environment variables.

## License

[Apache License 2.0](./LICENSE).

This project is an independent port and is not an official Xiaomi release.
