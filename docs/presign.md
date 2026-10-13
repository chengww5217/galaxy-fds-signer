# Pre-signed URLs

A pre-signed URL carries its credentials in the query string:

```
https://cnbj1.fds.api.xiaomi.com/bkt/dir/obj.txt?GalaxyAccessKeyId=AK…&Expires=1760000000000&Signature=…
```

Anyone holding the URL can make that one request (same method, same signed headers) until `Expires`, without the secret. Generate it on the server or in an edge function, and hand it to a browser, app or third party.

```ts
// Server / edge function
const { url, method, headers, expiresAt } = await signer.presign({
  method: 'PUT',
  bucket: 'uploads',
  object: `avatars/${userId}.png`,
  headers: { 'content-type': 'image/png' },
  expiresIn: 300,
});

// Browser
await fetch(url, { method, headers, body: file });
```

See [`PresignInput`](./api.md#presigninput) for all options.

When `fetch` runs in a browser on another origin, the bucket must allow that origin through CORS. Configure it with `updateBucketCORSConfiguration` (see [Operations](./operations.md)). Without CORS, the browser blocks the request, even though the signature is valid.

## What the signature covers

| Part | Signed | Consequence |
| --- | --- | --- |
| HTTP method | yes | A `GET` URL cannot be used to `PUT` or `DELETE`. |
| Bucket and object path | yes | The URL cannot be redirected to another object. |
| Sub-resources (`acl`, `uploadId`, `partNumber`, …) | yes | A part-upload URL is bound to one upload id and part number. |
| `Expires` | yes | It cannot be extended. |
| `content-type`, `content-md5` | only if passed in `headers` | When signed, the client must send exactly that value. Signing `content-md5` pins the exact content. |
| `x-xiaomi-*` headers (`x-xiaomi-meta-*`, `x-xiaomi-acl`, …) | only if passed in `headers` | When signed, the client must send them. |
| Host | no | The same signature works on the virtual-hosted and path-style hosts. |
| Other headers (`range`, …) and other query parameters | no | The client may change them. |

`headers` in the result is exactly the set the client must send. It is `{}` unless you signed some.

## Expiration

| Input | Meaning |
| --- | --- |
| nothing | 15 minutes from now |
| `expiresIn: 600` | 600 **seconds** from now |
| `expires: new Date('2030-01-01')` | absolute |
| `expires: 1893456000000` | absolute, epoch **milliseconds** |

Values in seconds (`expires: 1893456000`), fractional values and times in the past are rejected, so you can't produce a URL that is already expired or whose signature doesn't match. `expiresAt` in the result is the epoch-millisecond expiration.

## Supported operations

These are all the operations from the [operations list](./operations.md) that need no unsigned query parameters. For each one, `presign` produces the same signature as the Java SDK's `generatePresignedUri`; this is tested in `test/operations.test.ts`.

<!-- generated:start -->
| Operation | Java SDK | `presign` input | The client must send |
| --- | --- | --- | --- |
| Delete a bucket | `deleteBucket` | `{ method: 'DELETE', bucket: 'bkt' }` | no extra headers |
| Get bucket information | `getBucketInfo` | `{ method: 'GET', bucket: 'bkt' }` | no extra headers |
| Check whether a bucket exists | `doesBucketExist` | `{ method: 'HEAD', bucket: 'bkt' }` | no extra headers |
| Get the bucket ACL | `getBucketAcl` | `{ method: 'GET', bucket: 'bkt', subResources: ['acl'] }` | no extra headers |
| Set the bucket ACL | `setBucketAcl` | `{ method: 'PUT', bucket: 'bkt', subResources: ['acl'], headers: { 'content-type': 'application/json; charset=UTF-8' } }` | `content-type: application/json; charset=UTF-8`; body: ACL JSON |
| Get the bucket quota | `getBucketQuota` | `{ method: 'GET', bucket: 'bkt', subResources: ['quota'] }` | no extra headers |
| Set the bucket quota | `setBucketQuota` | `{ method: 'PUT', bucket: 'bkt', subResources: ['quota'], headers: { 'content-type': 'application/json; charset=UTF-8' } }` | `content-type: application/json; charset=UTF-8`; body: Quota JSON |
| Upload an object | `putObject` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', headers: { 'content-type': 'text/plain', 'x-xiaomi-meta-k': 'v' } }` | `content-type: text/plain`, `x-xiaomi-meta-k: v`; body: File bytes |
| Download an object | `getObject` | `{ method: 'GET', bucket: 'bkt', object: 'dir/obj.txt' }` | no extra headers |
| Download part of an object (`range` header) | `getObjectRange` | `{ method: 'GET', bucket: 'bkt', object: 'dir/obj.txt', headers: { range: 'bytes=10-' } }` | `range: bytes=10-` |
| Check whether an object exists | `doesObjectExist` | `{ method: 'HEAD', bucket: 'bkt', object: 'dir/obj.txt' }` | no extra headers |
| Delete an object | `deleteObject` | `{ method: 'DELETE', bucket: 'bkt', object: 'dir/obj.txt' }` | no extra headers |
| Get object metadata | `getObjectMetadata` | `{ method: 'GET', bucket: 'bkt', object: 'dir/obj.txt', subResources: ['metadata'] }` | no extra headers |
| Get the object ACL | `getObjectAcl` | `{ method: 'GET', bucket: 'bkt', object: 'dir/obj.txt', subResources: ['acl'] }` | no extra headers |
| Set the object ACL | `setObjectAcl` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', subResources: ['acl'], headers: { 'content-type': 'application/json; charset=UTF-8' } }` | `content-type: application/json; charset=UTF-8`; body: ACL JSON |
| Make an object public (an ACL grant for `ALL_USERS`) | `setPublic` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', subResources: ['acl'], headers: { 'content-type': 'application/json; charset=UTF-8' } }` | `content-type: application/json; charset=UTF-8`; body: ACL JSON |
| Start a multipart upload (returns `uploadId`) | `initMultipartUpload` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', subResources: ['uploads'], headers: { 'content-type': 'application/json; charset=UTF-8' } }` | `content-type: application/json; charset=UTF-8` |
| Upload one part | `uploadPart` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', subResources: { uploadId: 'UPID', partNumber: 3 }, headers: { 'content-type': 'application/octet-stream' } }` | `content-type: application/octet-stream`; body: Part bytes |
| Complete a multipart upload | `completeMultipartUpload` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', subResources: { uploadId: 'UPID' }, headers: { 'content-type': 'application/octet-stream' } }` | `content-type: application/octet-stream`; body: JSON (`{ uploadPartResultList }`) |
| Abort a multipart upload | `abortMultipartUpload` | `{ method: 'DELETE', bucket: 'bkt', object: 'dir/obj.txt', subResources: { uploadId: 'UPID' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | `content-type: application/json; charset=UTF-8` |
<!-- generated:end -->

Operations that need unsigned query parameters can't be expressed with `presign`, because it has no `query` field. Examples: `listObjects` (`prefix`, `delimiter`), `deleteBucketAcl` (`action=delete`), lifecycle, CORS, `renameObject` and `getThumbnail`. Use `signRequest` for those, and send the request from where the secret lives or hand out the signed request.

A signature only proves who signed the request. FDS still checks that the access key is allowed to perform the operation.

## Multipart upload from the browser

The browser can upload parts directly to FDS. The server only signs. Reading `res.json()` in the browser also requires CORS:

```ts
// Server: start the upload with a signed request, then pre-sign one URL per part
const init = await signer.signRequest({
  method: 'PUT', bucket, object, subResources: ['uploads'],
  headers: { 'content-type': 'application/json; charset=UTF-8' },
});
const { uploadId } = await (await fetch(init.url, init)).json();

const parts = await Promise.all(
  Array.from({ length: partCount }, (_, i) =>
    signer.presign({
      method: 'PUT', bucket, object,
      subResources: { uploadId, partNumber: i + 1 },
      headers: { 'content-type': 'application/octet-stream' },
      expiresIn: 3600,
    }),
  ),
);
// Send `parts` to the browser. Each one is { url, method, headers, expiresAt }.

// Browser
const results = [];
for (const [i, part] of parts.entries()) {
  const res = await fetch(part.url, { method: part.method, headers: part.headers, body: chunks[i] });
  results.push(await res.json());
}

// Server: complete the upload with results from the browser
const done = await signer.signRequest({
  method: 'PUT', bucket, object, subResources: { uploadId },
  headers: { 'content-type': 'application/octet-stream' },
});
await fetch(done.url, { ...done, body: JSON.stringify({ uploadPartResultList: results }) });
```

To abort, use `{ method: 'DELETE', subResources: { uploadId } }`.

## CDN and virtual-hosted endpoints

- `cdn: true` signs a URL on the CDN host (`cdn.{region}.fds.api.mi-img.com` by default, or `cdnEndpoint` / `cdnBaseUri`).
- On `*.mi-fds.com` endpoints the URL is `https://{bucket}.{region}.mi-fds.com/{bucket}/{object}?…`. The host is not signed, so the signature is the same as with path-style addressing. These endpoints have no default CDN host, so set `cdnEndpoint` if you need `cdn: true` there.
