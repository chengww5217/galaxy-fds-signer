# API reference

```ts
import {
  createSigner, signRequest, presign,               // functions
  HttpMethod, SignAlgorithm, SubResource, XiaomiHeader, // constants
  GalaxyFDSSignerError, ErrorCode,                  // errors
} from 'galaxy-fds-signer';
```

Every function is asynchronous except `createSigner`, because Web Crypto is. Every type below is exported for TypeScript.

- [`createSigner(options)`](#createsigneroptions)
- [`signer.signRequest(input)`](#signersignrequestinput)
- [`signer.presign(input)`](#signerpresigninput)
- [`signRequest(options, input)` / `presign(options, input)`](#one-shot-helpers)
- [Headers](#headers)
- [Sub-resources](#sub-resources)
- [Constants](#constants)
- [Errors](#errors)
- [How signing works](#how-signing-works)

## `createSigner(options)`

```ts
function createSigner(options: SignerOptions): FdsSigner;
```

Validates the options and returns a frozen signer object. Any configuration error throws a `GalaxyFDSSignerError` synchronously.

### `SignerOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `accessId` | `string` | required | Access key id. |
| `accessSecret` | `string` | required | Secret access key. It is kept in a closure and never exposed on the signer, in logs or in results. |
| `algorithm` | `'HmacSHA1' \| 'HmacSHA256' \| 'HmacMD5'` | `'HmacSHA1'` | HMAC algorithm. |
| `bucket` | `string` | — | Default bucket for every request that does not name one itself. An input `bucket` overrides it. It must not contain `/`, and on virtual-hosted (`.mi-fds.com`) endpoints it must be a single DNS label. |
| `endpoint` | `string` | — | Service host, optionally with a port. The host must end with `.fds.api.xiaomi.com` (public), `-fds.api.xiaomi.net` (internal) or `.mi-fds.com` (virtual-hosted). The region name is taken from the prefix. |
| `regionName` | `string` | — | Used only when `endpoint` is omitted. Sets the endpoint to `{regionName}.fds.api.xiaomi.com`. |
| `cdnEndpoint` | `string` | `cdn.{region}.fds.api.mi-img.com` | CDN host for `cdn: true`. No CDN host is derived for `*.mi-fds.com` endpoints, so set this yourself to use the CDN there. |
| `enableHttps` | `boolean` | `true` if an endpoint is set | Ignored for `*.mi-fds.com` endpoints, which always use HTTPS. |
| `baseUri` | `string` | — | Explicit service base URL (`http(s)://host[:port]/`). It takes precedence over `endpoint`. |
| `cdnBaseUri` | `string` | — | Explicit CDN base URL. It takes precedence over `cdnEndpoint`. |

Without `endpoint`, `regionName` and `baseUri`, the signer uses `http://files.fds.api.xiaomi.com/`, and `http://cdn.fds.api.xiaomi.com/` for the CDN.

Set `bucket` once to have every `signRequest` and `presign` call use it; pass `bucket` in the input to override it for a single call. Without it, `presign` still requires a `bucket`, and `signRequest` needs one whenever `object` or `subResources` is given.

With a `*.mi-fds.com` endpoint, URLs use virtual-hosted addressing: `https://{bucket}.{endpoint}/{bucket}/{object}`. The bucket stays in the path as well, as in the Java SDK. In this mode the bucket must be a single DNS label: letters, digits and inner hyphens, at most 63 characters.

### `FdsSigner`

```ts
interface FdsSigner {
  readonly accessId: string;
  signRequest(input: SignRequestInput): Promise<SignedRequest>;
  presign(input: PresignInput): Promise<PresignedRequest>;
}
```

The methods do not depend on `this`, so you can destructure them.

## `signer.signRequest(input)`

```ts
signRequest(input: SignRequestInput): Promise<SignedRequest>;
```

Builds a request that authenticates with an `Authorization: Galaxy-V2 …` header. [Operations](./operations.md) shows the input for every FDS operation.

### `SignRequestInput`

Give either a resource target (`bucket` / `object` / `subResources` / `cdn` / `query`) or an explicit `url`, but not both.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `method` | `'GET' \| 'HEAD' \| 'PUT' \| 'POST' \| 'DELETE'`, upper or lower case | `'GET'` | HTTP method. It is normalized to upper case. |
| `bucket` | `string` | configured `bucket` | Bucket name. Omit it to use the signer's `bucket` option; when none is configured, omit it only for service-level requests such as listing buckets. It must not contain `/`. |
| `object` | `string` | — | Object name, e.g. `photos/2024/cat.png`. It is percent-encoded for you; spaces and non-ASCII characters are fine. It requires `bucket`. |
| `subResources` | [`SubResources`](#sub-resources) | — | Signed query parameters, e.g. `['acl']` or `{ uploadId, partNumber: 1 }`. They require `bucket`. |
| `query` | `Record<string, string \| number>` | — | Extra query parameters, URL-encoded and appended after the sub-resources. They are sent but not signed, as in the Java SDK. Use `''` for a bare flag (`{ cors: '' }` produces `?cors=`). Sub-resource names and `Expires` / `GalaxyAccessKeyId` / `Signature` are rejected, since the signature would interpret them. |
| `cdn` | `boolean` | `false` | Target the CDN host instead of the service host. |
| `url` | `string` | — | An absolute, already-encoded URL to sign as-is. Use it instead of the fields above. |
| `headers` | [`RequestHeaders`](#headers) | — | Headers to sign and send, e.g. `content-type`, `content-md5`, `x-xiaomi-meta-*`. |
| `date` | `Date` | now | Value of the generated `x-xiaomi-date` header. |

If `headers` contains neither `date` nor `x-xiaomi-date`, an `x-xiaomi-date` header is added. Browsers cannot set `Date` from script; `x-xiaomi-date` is the equivalent FDS accepts.

### `SignedRequest`

```ts
interface SignedRequest {
  url: string;                      // absolute, fully encoded
  method: HttpMethod;               // upper case
  headers: Record<string, string>;  // lower-case names, including `authorization`
}
```

It is plain, JSON-serializable data and can be passed straight to `fetch`:

```ts
const req = await signer.signRequest({ method: 'PUT', bucket, object, headers: { 'content-type': type } });
await fetch(req.url, { ...req, body });
```

Send every header exactly as returned, because each one is part of the signature. FDS checks the request date (the Java SDK allows 15 minutes of clock skew), so send the request soon after signing it. Don't cache signed requests.

## `signer.presign(input)`

```ts
presign(input: PresignInput): Promise<PresignedRequest>;
```

Builds a URL that carries its credentials in the query string (`GalaxyAccessKeyId`, `Expires`, `Signature`). Anyone holding the URL can make that one request until it expires. [Pre-signed URLs](./presign.md) lists every supported operation.

### `PresignInput`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `method` | as above | `'GET'` | The HTTP method the URL will be used with. It is signed, so a URL signed for `GET` does not work for `PUT`. |
| `bucket` | `string` | configured `bucket` | Bucket name. Required only when the signer has no `bucket` option. |
| `object` | `string` | — | Object name. Omit it for bucket-level operations. |
| `subResources` | [`SubResources`](#sub-resources) | — | Signed sub-resources, e.g. `['acl']` or `{ uploadId, partNumber }`. |
| `cdn` | `boolean` | `false` | Pre-sign a CDN URL. |
| `expires` | `Date \| number` | — | Absolute expiration as a `Date` or epoch **milliseconds**. It takes precedence over `expiresIn`. |
| `expiresIn` | `number` | `900` | Lifetime in **seconds** from now. |
| `headers` | [`RequestHeaders`](#headers) | — | Headers to include in the signature: `content-type`, `content-md5`, `x-xiaomi-*`. |

Pre-signed URLs have no `query` field, because extra query parameters are not covered by the signature. To list objects with `prefix` and similar parameters, use `signRequest`.

### `PresignedRequest`

```ts
interface PresignedRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;  // what the client must send; {} unless you signed headers
  expiresAt: number;                // epoch milliseconds
}
```

## One-shot helpers

```ts
function signRequest(options: SignerOptions, input: SignRequestInput): Promise<SignedRequest>;
function presign(options: SignerOptions, input: PresignInput): Promise<PresignedRequest>;
```

They are the same as `createSigner(options).signRequest(input)` and `createSigner(options).presign(input)`, but configuration errors reject the promise instead of throwing.

## Headers

`RequestHeaders` can be any of:

```ts
{ 'Content-Type': 'image/png' }             // plain object
new Headers({ 'Content-Type': 'image/png' }) // WHATWG Headers
[['content-type', 'image/png']]              // [name, value] pairs
```

Names are case-insensitive and returned in lower case. A name may appear only once. HTTP clients join repeated headers with `", "` while the signature joins them with `","`, so a repeated header could never verify.

Values are trimmed of leading and trailing whitespace before signing and returned trimmed, since `fetch` strips it before sending. Anything `Headers` would reject throws `INVALID_HEADERS` up front: a name that is not an HTTP token, or a value containing NUL, CR, LF or a character above U+00FF.

The signature covers:

| Header | Signed |
| --- | --- |
| `content-md5` | yes |
| `content-type` | yes. Any `multipart/form-data; boundary=…` value is signed as plain `multipart/form-data` |
| `date` | yes, unless `x-xiaomi-date` is present |
| `x-xiaomi-*` (including `x-xiaomi-meta-*`) | yes. Names are sorted |
| anything else (`range`, `cache-control`, …) | no. These are passed through unsigned |

## Sub-resources

```ts
type SubResources =
  | SubResource[]                                                  // ['acl'], ['uploads']
  | Partial<Record<SubResource, string | number | boolean | undefined>>; // { uploadId: 'x', partNumber: 2 }
```

Only these names are allowed. They are the only query parameters FDS includes in a signature:

| Name | Typical use |
| --- | --- |
| `acl` | Bucket or object ACL |
| `quota` | Bucket quota |
| `uploads` | Start a multipart upload |
| `uploadId` | Multipart upload id |
| `partNumber` | Multipart part number |
| `metadata` | Object metadata |
| `storageAccessToken` | Storage access token |
| `compression` | Compression |

Values are URL-encoded. `true` renders as a bare name (`?acl`), while `false` and `undefined` are skipped. Any other name throws, because it would not be signed. For unsigned parameters, use `query` in `signRequest`.

## Constants

Each constant is a plain object with a matching literal union type. You can also pass the plain strings.

| Constant | Values |
| --- | --- |
| `HttpMethod` | `GET`, `HEAD`, `PUT`, `POST`, `DELETE` |
| `SignAlgorithm` | `HmacSHA1`, `HmacSHA256`, `HmacMD5` |
| `SubResource` | `ACL: 'acl'`, `QUOTA: 'quota'`, `UPLOADS: 'uploads'`, `PART_NUMBER: 'partNumber'`, `UPLOAD_ID: 'uploadId'`, `STORAGE_ACCESS_TOKEN: 'storageAccessToken'`, `COMPRESSION: 'compression'`, `METADATA: 'metadata'` |
| `XiaomiHeader` | `DATE: 'x-xiaomi-date'`, `REQUEST_ID: 'x-xiaomi-request-id'`, `ACL: 'x-xiaomi-acl'`, `ACL_META: 'x-xiaomi-meta-acl'`, `CONTENT_LENGTH: 'x-xiaomi-meta-content-length'`, `MD5_ATTACHED_STREAM: 'x-xiaomi-meta-md5-attached-stream'` |

## Errors

Every failure is a `GalaxyFDSSignerError`, a subclass of `Error`. `createSigner` throws it; `signRequest` and `presign` reject with it.

```ts
class GalaxyFDSSignerError extends Error {
  readonly code: GalaxyFDSSignerErrorCode; // e.g. 'INVALID_BUCKET'
  readonly kind: 'config' | 'input' | 'runtime';
  readonly field?: string;                 // e.g. 'bucket', 'expiresIn'
  toJSON(): { name, code, kind, field?, message };
}
```

- `code` and `kind` are stable; `message` is for humans and may change. `ErrorCode` lists every code (`ErrorCode.INVALID_BUCKET === 'INVALID_BUCKET'`).
- `field` names the option or input field at fault, when there is one.
- `cause` holds the underlying error, if any (for example from `new URL`). `toJSON()` leaves out `cause` and the stack, so `JSON.stringify(err)` is safe to send. Messages never include the secret.
- `kind` tells you who is at fault: `config` errors come from your signer configuration and may mention internal hosts, `input` errors from the request being signed, `runtime` errors from the environment. Mapping errors to HTTP statuses is up to you.

| `code` | `kind` | `field` | Cause |
| --- | --- | --- | --- |
| `INVALID_OPTIONS` | config | `options` | `options` is not an object |
| `INVALID_CREDENTIALS` | config | `accessId`, `accessSecret` | Missing, empty or non-string credentials |
| `UNSUPPORTED_ALGORITHM` | config | `algorithm` | Unknown `algorithm` |
| `INVALID_ENDPOINT` | config | `endpoint`, `baseUri`, `cdnBaseUri` | An empty `endpoint` or one with an unrecognized suffix, or a `baseUri` / `cdnBaseUri` that is not an absolute http(s) URL |
| `INVALID_BUCKET_OPTION` | config | `bucket` | The configured `bucket` is empty, contains `/`, or is not a DNS label on a `*.mi-fds.com` endpoint |
| `CDN_NOT_CONFIGURED` | config | `cdn` | `cdn: true` with no CDN endpoint, e.g. `*.mi-fds.com` without `cdnEndpoint` |
| `UNSUPPORTED_METHOD` | input | `method` | Unsupported `method` |
| `INVALID_INPUT` | input | `input` | The input object is missing or not an object |
| `INVALID_HEADERS` | input | `headers` | A repeated header name, a non-string or non-token name, a value with NUL / CR / LF / characters above U+00FF, or headers in an unsupported shape |
| `MISSING_DATE` | input | `headers` | Neither `date` nor `x-xiaomi-date` (internal signing only; `signRequest` always adds one) |
| `INVALID_BUCKET` | input | `bucket` | A missing `bucket` for `presign`, or for `object` / `subResources`; a bucket containing `/`; a bucket that is not a DNS label on a `*.mi-fds.com` endpoint |
| `INVALID_OBJECT` | input | `object` | `object` is not a string |
| `INVALID_SUB_RESOURCE` | input | `subResources` | A sub-resource name not in the list above, or a value that is not a string, number or boolean |
| `INVALID_QUERY` | input | `query` | `query` is not an object, a value is not a string or number, or a name is reserved (a sub-resource, `Expires`, `GalaxyAccessKeyId` or `Signature`, in any case) |
| `INVALID_URL` | input | `url` | An empty, relative or malformed `url`, or `url` combined with `bucket` / `object` / `subResources` / `cdn` / `query` |
| `INVALID_DATE` | input | `date` | `date` is not a valid `Date` |
| `INVALID_EXPIRATION` | input | `expires`, `expiresIn` | An expiration that is not an integer, is in seconds instead of milliseconds, or is in the past; `expiresIn <= 0` |
| `CRYPTO_UNAVAILABLE` | runtime | | `globalThis.crypto.subtle` is missing |
| `SIGNING_FAILED` | runtime | | Any unexpected failure while signing; see `cause` |

```ts
try {
  return Response.json(await signer.presign({ bucket, object, expiresIn }));
} catch (e) {
  if (e instanceof GalaxyFDSSignerError && e.kind === 'input') {
    return Response.json(e, { status: 400 }); // { name, code, kind, field, message }
  }
  throw e; // config / runtime: log it, answer with a generic 500
}
```

## How signing works

The Galaxy-V2 signature is an HMAC over:

```
{METHOD}\n{content-md5}\n{content-type}\n{date, or Expires for pre-signed URLs}\n
{sorted x-xiaomi-* headers as name:value\n}{decoded path}{?sorted sub-resources}
```

Only the [sub-resources](#sub-resources) are part of the signature; other query parameters are not. When `x-xiaomi-date` is present, the `date` line is left empty. The path and query are percent-decoded the same way `java.net.URI` decodes them.
