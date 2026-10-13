# Operations

This page lists every Galaxy FDS operation that the official Java SDK client (`GalaxyFDSClient`, 3.0.37) sends, and the `signRequest` input that produces the same request. All rows are tested in `test/operations.test.ts`: `signRequest` must produce the exact URL and signature the Java client produces.

```ts
const req = await signer.signRequest({ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', subResources: ['acl'],
  headers: { 'content-type': 'application/json; charset=UTF-8' } });
await fetch(req.url, { ...req, body: JSON.stringify(acl) });
```

How to read the tables:

- HTTP request is what the Java client sends, with example values (`bkt`, `dir/obj.txt`, `UPID`, …).
- `subResources` are signed. `query` parameters are sent but not signed; the Java SDK treats them the same way. Pass `''` for a bare flag (`{ cors: '' }` produces `?cors=`).
- `content-type` is listed when the Java client sends one. It is signed, so send the same value you signed.
- Body is what you pass to `fetch` as `body`. This library never builds or reads bodies.
- Pre-sign ✅ means the operation needs no unsigned query parameters, so you can also hand it out as a [pre-signed URL](./presign.md).

Not included: `listNextBatchOf*` (same request as the list call, with `marker`), and the Java SDK's local helpers that send no request (`generate*Uri`, anti-stealing links). `deleteObject(bucket, object, versionId)` is not included either, because the 3.0.37 client sends the version id in a way that could not be captured.

<!-- generated:start -->
### Service

| Operation | Java SDK | HTTP request | `signRequest` input | Body | Pre-sign |
| --- | --- | --- | --- | --- | :---: |
| List buckets you own | `listBuckets` | `GET /` | `{ method: 'GET' }` | — | — |
| List buckets you are authorized to access | `listAuthorizedBuckets` | `GET /?authorizedBuckets=` | `{ method: 'GET', query: { authorizedBuckets: '' } }` | — | — |

### Buckets

| Operation | Java SDK | HTTP request | `signRequest` input | Body | Pre-sign |
| --- | --- | --- | --- | --- | :---: |
| Create a bucket | `createBucket` | `PUT /bkt` | `{ method: 'PUT', bucket: 'bkt', headers: { 'content-type': 'application/json; charset=UTF-8' } }` | JSON (`{}`) | — |
| Delete a bucket | `deleteBucket` | `DELETE /bkt` | `{ method: 'DELETE', bucket: 'bkt' }` | — | ✅ |
| Get bucket information | `getBucketInfo` | `GET /bkt` | `{ method: 'GET', bucket: 'bkt' }` | — | ✅ |
| Check whether a bucket exists | `doesBucketExist` | `HEAD /bkt` | `{ method: 'HEAD', bucket: 'bkt' }` | — | ✅ |
| List objects (`prefix`, `delimiter`, `marker`, `maxKeys`, …) | `listObjects` | `GET /bkt?isBackup=false&prefix=dir%2F&delimiter=%2F&reverse=false` | `{ method: 'GET', bucket: 'bkt', query: { isBackup: 'false', prefix: 'dir/', delimiter: '/', reverse: 'false' } }` | — | — |
| List object versions | `listVersions` | `GET /bkt?versions=&prefix=dir%2F&delimiter=%2F` | `{ method: 'GET', bucket: 'bkt', query: { versions: '', prefix: 'dir/', delimiter: '/' } }` | — | — |
| List objects in the trash (the bucket name goes in `prefix`) | `listTrashObjects` | `GET /trash?isBackup=false&prefix=bkt%2Fdir%2F&delimiter=%2F&reverse=false` | `{ method: 'GET', bucket: 'trash', query: { isBackup: 'false', prefix: 'bkt/dir/', delimiter: '/', reverse: 'false' } }` | — | — |
| Get the bucket ACL | `getBucketAcl` | `GET /bkt?acl` | `{ method: 'GET', bucket: 'bkt', subResources: ['acl'] }` | — | ✅ |
| Set the bucket ACL | `setBucketAcl` | `PUT /bkt?acl` | `{ method: 'PUT', bucket: 'bkt', subResources: ['acl'], headers: { 'content-type': 'application/json; charset=UTF-8' } }` | ACL JSON | ✅ |
| Remove grants from the bucket ACL | `deleteBucketAcl` | `PUT /bkt?acl&action=delete` | `{ method: 'PUT', bucket: 'bkt', subResources: ['acl'], query: { action: 'delete' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | ACL JSON | — |
| Get the bucket quota | `getBucketQuota` | `GET /bkt?quota` | `{ method: 'GET', bucket: 'bkt', subResources: ['quota'] }` | — | ✅ |
| Set the bucket quota | `setBucketQuota` | `PUT /bkt?quota` | `{ method: 'PUT', bucket: 'bkt', subResources: ['quota'], headers: { 'content-type': 'application/json; charset=UTF-8' } }` | Quota JSON | ✅ |
| Delete multiple objects | `deleteObjects` | `PUT /bkt?deleteObjects=` | `{ method: 'PUT', bucket: 'bkt', query: { deleteObjects: '' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | JSON array of object names | — |
| Get the access log configuration | `getAccessLogConfig` | `GET /bkt?accessLog=` | `{ method: 'GET', bucket: 'bkt', query: { accessLog: '' } }` | — | — |
| Update the access log configuration | `updateAccessLogConfig` | `PUT /bkt?accessLog=` | `{ method: 'PUT', bucket: 'bkt', query: { accessLog: '' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | JSON | — |
| Get the lifecycle configuration | `getLifecycleConfig` | `GET /bkt?lifecycle=` | `{ method: 'GET', bucket: 'bkt', query: { lifecycle: '' } }` | — | — |
| Update the lifecycle configuration | `updateLifecycleConfig` | `PUT /bkt?lifecycle=` | `{ method: 'PUT', bucket: 'bkt', query: { lifecycle: '' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | JSON | — |
| Get the CORS configuration | `getBucketCORSConfiguration` | `GET /bkt?cors=` | `{ method: 'GET', bucket: 'bkt', query: { cors: '' } }` | — | — |
| Update the CORS configuration | `updateBucketCORSConfiguration` | `PUT /bkt?cors=` | `{ method: 'PUT', bucket: 'bkt', query: { cors: '' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | JSON | — |
| Bind a custom domain | `putDomainMapping` | `PUT /bkt?domain=img.example.com&index=index.html` | `{ method: 'PUT', bucket: 'bkt', query: { domain: 'img.example.com', index: 'index.html' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | — | — |
| List custom domains | `listDomainMappings` | `GET /bkt?domain=` | `{ method: 'GET', bucket: 'bkt', query: { domain: '' } }` | — | — |
| Unbind a custom domain | `deleteDomainMapping` | `DELETE /bkt?domain=img.example.com` | `{ method: 'DELETE', bucket: 'bkt', query: { domain: 'img.example.com' } }` | — | — |
| Set the mirror (back-to-origin) URL | `setMirror` | `PUT /bkt?mirror=` | `{ method: 'PUT', bucket: 'bkt', query: { mirror: '' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | Origin URL | — |
| Get the mirror URL | `getMirror` | `GET /bkt?mirror=` | `{ method: 'GET', bucket: 'bkt', query: { mirror: '' } }` | — | — |
| Delete the mirror URL | `deleteMirror` | `DELETE /bkt?mirror=` | `{ method: 'DELETE', bucket: 'bkt', query: { mirror: '' } }` | — | — |
| Get the anti-hotlinking configuration | `getTimestampAntiStealingLinkConfig` | `GET /bkt?antiStealingLink=` | `{ method: 'GET', bucket: 'bkt', query: { antiStealingLink: '' } }` | — | — |
| Update the anti-hotlinking configuration | `updateTimestampAntiStealingLinkConfig` | `PUT /bkt?antiStealingLink=` | `{ method: 'PUT', bucket: 'bkt', query: { antiStealingLink: '' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | JSON | — |
| Delete the anti-hotlinking configuration | `deleteTimestampAntiStealingLinkConfig` | `DELETE /bkt?antiStealingLink=` | `{ method: 'DELETE', bucket: 'bkt', query: { antiStealingLink: '' } }` | — | — |
| Move a bucket to another org / team | `migrateBucket` | `PUT /bkt?teamId=team&orgId=org&migrate=` | `{ method: 'PUT', bucket: 'bkt', query: { teamId: 'team', orgId: 'org', migrate: '' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | — | — |

### Objects

| Operation | Java SDK | HTTP request | `signRequest` input | Body | Pre-sign |
| --- | --- | --- | --- | --- | :---: |
| Upload an object | `putObject` | `PUT /bkt/dir/obj.txt` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', headers: { 'content-type': 'text/plain', 'x-xiaomi-meta-k': 'v' } }` | File bytes | ✅ |
| Upload an object with a server-generated name | `postObject` | `POST /bkt/` | `{ method: 'POST', url: 'https://cnbj1.fds.api.xiaomi.com/bkt/', headers: { 'content-type': 'text/plain', 'x-xiaomi-meta-k': 'v' } }` | File bytes | — |
| Download an object | `getObject` | `GET /bkt/dir/obj.txt` | `{ method: 'GET', bucket: 'bkt', object: 'dir/obj.txt' }` | — | ✅ |
| Download part of an object (`range` header) | `getObjectRange` | `GET /bkt/dir/obj.txt` | `{ method: 'GET', bucket: 'bkt', object: 'dir/obj.txt', headers: { range: 'bytes=10-' } }` | — | ✅ |
| Download a specific object version | `getObjectVersion` | `GET /bkt/dir/obj.txt?versionId=v1` | `{ method: 'GET', bucket: 'bkt', object: 'dir/obj.txt', query: { versionId: 'v1' } }` | — | — |
| Check whether an object exists | `doesObjectExist` | `HEAD /bkt/dir/obj.txt` | `{ method: 'HEAD', bucket: 'bkt', object: 'dir/obj.txt' }` | — | ✅ |
| Delete an object | `deleteObject` | `DELETE /bkt/dir/obj.txt` | `{ method: 'DELETE', bucket: 'bkt', object: 'dir/obj.txt' }` | — | ✅ |
| Get object metadata | `getObjectMetadata` | `GET /bkt/dir/obj.txt?metadata` | `{ method: 'GET', bucket: 'bkt', object: 'dir/obj.txt', subResources: ['metadata'] }` | — | ✅ |
| Replace object metadata | `setObjectMetadata` | `PUT /bkt/dir/obj.txt?setMetaData=` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', query: { setMetaData: '' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | JSON (`{ rawMeta }`) | — |
| Get the object ACL | `getObjectAcl` | `GET /bkt/dir/obj.txt?acl` | `{ method: 'GET', bucket: 'bkt', object: 'dir/obj.txt', subResources: ['acl'] }` | — | ✅ |
| Set the object ACL | `setObjectAcl` | `PUT /bkt/dir/obj.txt?acl` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', subResources: ['acl'], headers: { 'content-type': 'application/json; charset=UTF-8' } }` | ACL JSON | ✅ |
| Remove grants from the object ACL | `deleteObjectAcl` | `PUT /bkt/dir/obj.txt?acl&action=delete` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', subResources: ['acl'], query: { action: 'delete' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | ACL JSON | — |
| Make an object public (an ACL grant for `ALL_USERS`) | `setPublic` | `PUT /bkt/dir/obj.txt?acl` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', subResources: ['acl'], headers: { 'content-type': 'application/json; charset=UTF-8' } }` | ACL JSON | ✅ |
| Copy an object (the request targets the destination) | `copyObject` | `PUT /bkt2/copy.txt?cp=` | `{ method: 'PUT', bucket: 'bkt2', object: 'copy.txt', query: { cp: '' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | JSON (`{ srcBucketName, srcObjectName }`) | — |
| Rename an object | `renameObject` | `PUT /bkt/dir/obj.txt?renameTo=dir%2Fnew.txt` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', query: { renameTo: 'dir/new.txt' }, headers: { 'content-type': 'application/octet-stream' } }` | — | — |
| Restore an object from the trash | `restoreObject` | `PUT /bkt/dir/obj.txt?restore=` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', query: { restore: '' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | — | — |
| Restore an archived object | `restoreArchivedObject` | `PUT /bkt/dir/obj.txt?restoreArchive=true` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', query: { restoreArchive: 'true' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | — | — |
| Prefetch an object into the CDN | `prefetchObject` | `PUT /bkt/dir/obj.txt?prefetch=` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', query: { prefetch: '' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | — | — |
| Refresh the CDN cache of an object | `refreshObject` | `PUT /bkt/dir/obj.txt?refresh=` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', query: { refresh: '' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | — | — |
| Get an image thumbnail | `getThumbnail` | `GET /bkt/dir/obj.txt?thumb=1&w=100&h=80` | `{ method: 'GET', bucket: 'bkt', object: 'dir/obj.txt', query: { thumb: 1, w: 100, h: 80 } }` | — | — |
| Crop an image in place | `cropImage` | `PUT /bkt/dir/obj.txt?w=100&x=0&h=80&y=0&cropImage=` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', query: { w: 100, x: 0, h: 80, y: 0, cropImage: '' }, headers: { 'content-type': 'application/octet-stream' } }` | — | — |
| Get a third-party object | `getThirdPartyObject` | `GET /bkt/dir/obj.txt?thirdPartyObject=` | `{ method: 'GET', bucket: 'bkt', object: 'dir/obj.txt', query: { thirdPartyObject: '' } }` | — | — |

### Multipart upload

| Operation | Java SDK | HTTP request | `signRequest` input | Body | Pre-sign |
| --- | --- | --- | --- | --- | :---: |
| Start a multipart upload (returns `uploadId`) | `initMultipartUpload` | `PUT /bkt/dir/obj.txt?uploads` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', subResources: ['uploads'], headers: { 'content-type': 'application/json; charset=UTF-8' } }` | — | ✅ |
| Upload one part | `uploadPart` | `PUT /bkt/dir/obj.txt?uploadId=UPID&partNumber=3` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', subResources: { uploadId: 'UPID', partNumber: 3 }, headers: { 'content-type': 'application/octet-stream' } }` | Part bytes | ✅ |
| Complete a multipart upload | `completeMultipartUpload` | `PUT /bkt/dir/obj.txt?uploadId=UPID` | `{ method: 'PUT', bucket: 'bkt', object: 'dir/obj.txt', subResources: { uploadId: 'UPID' }, headers: { 'content-type': 'application/octet-stream' } }` | JSON (`{ uploadPartResultList }`) | ✅ |
| Abort a multipart upload | `abortMultipartUpload` | `DELETE /bkt/dir/obj.txt?uploadId=UPID` | `{ method: 'DELETE', bucket: 'bkt', object: 'dir/obj.txt', subResources: { uploadId: 'UPID' }, headers: { 'content-type': 'application/json; charset=UTF-8' } }` | — | ✅ |

<!-- generated:end -->

## Notes

- Object names can contain `/`, spaces and non-ASCII characters. Pass them unencoded; the library encodes them the way `java.net.URI` does.
- For `postObject`, use `url` because the Java client posts to `/{bucket}/` with a trailing slash. The server picks the object name.
- For `copyObject`, the request targets the destination. The source goes in the JSON body.
- For `getObjectRange`, `range` is not part of the signature, so you can change it without signing again.
- ACL, quota, lifecycle, CORS and similar bodies are the JSON documents the Java SDK serializes. See the corresponding model classes in `galaxy-fds-sdk-java`.
