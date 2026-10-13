/**
 * Live, end-to-end checks against a real FDS bucket, exercising the built
 * package in `dist/` — the artifact that is actually published to npm.
 *
 * The point of this suite is not to touch all 57 operations: `test/golden.test.ts`
 * and `test/operations.test.ts` already pin the URL and signature of every one
 * of them byte-for-byte against the Java SDK. What only a real server can prove
 * is that the requests are accepted, so this file covers one representative of
 * each request shape the signer has to get right:
 *
 * - header-signed GET / PUT / HEAD / DELETE on an object;
 * - a sub-resource without a value (`?metadata`);
 * - sub-resources with values (`?uploadId=…&partNumber=…`), plus completing and
 *   aborting a multipart upload;
 * - unsigned query parameters (`?prefix=…`);
 * - a pre-signed URL (credentials in the query string) used for an upload;
 * - the CDN host, which authorizes with the query string and never sees
 *   `Authorization`.
 *
 * Bucket-level and destructive operations (ACL, quota, lifecycle, CORS,
 * access log, createBucket/deleteBucket, migrate, restore, trash, thumbnail,
 * postObject, mirrors) are deliberately not automated: they mutate shared
 * state, need dedicated bucket configuration, or are asynchronous, and they
 * add no new signing shape.
 *
 * Skipped unless `FDS_ACCESS_ID`, `FDS_ACCESS_SECRET`, `FDS_BUCKET` and one of
 * `FDS_ENDPOINT` / `FDS_REGION` / `FDS_BASE_URI` are set:
 *
 * | Variable | Meaning |
 * | --- | --- |
 * | `FDS_ACCESS_ID` | Access key id. |
 * | `FDS_ACCESS_SECRET` | Secret access key. |
 * | `FDS_BUCKET` | Bucket to write to; must be writable by the key. |
 * | `FDS_ENDPOINT` | e.g. `cnbj1.fds.api.xiaomi.com`, or `FDS_REGION` instead. |
 * | `FDS_BASE_URI` | Explicit service base URL, e.g. a local mock; takes precedence. |
 * | `FDS_CDN_BASE_URI` | Explicit CDN base URL; defaults to `cdn.{region}.fds.api.mi-img.com`. |
 * | `FDS_UPLOAD_FILE` | Local file to upload; a temporary file is used otherwise. |
 *
 * Everything is created under `integration/` and deleted afterwards. Run it all
 * with `npm run test:integration`, which builds `dist/` first.
 */
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Lib = typeof import('../../src/index.js');
type FdsSigner = ReturnType<Lib['createSigner']>;

/** The multipart payload: one 64 KiB part, i.e. small enough to stay fast. */
const PART_BYTES = 64 * 1024;

const {
  FDS_ACCESS_ID,
  FDS_ACCESS_SECRET,
  FDS_BUCKET,
  FDS_ENDPOINT,
  FDS_REGION,
  FDS_BASE_URI,
  FDS_CDN_BASE_URI,
  FDS_UPLOAD_FILE,
} = process.env;

const missing: string[] = [];
if (!FDS_ACCESS_ID) missing.push('FDS_ACCESS_ID');
if (!FDS_ACCESS_SECRET) missing.push('FDS_ACCESS_SECRET');
if (!FDS_BUCKET) missing.push('FDS_BUCKET');
if (!FDS_BASE_URI && !FDS_ENDPOINT && !FDS_REGION) {
  missing.push('FDS_ENDPOINT (or FDS_REGION / FDS_BASE_URI)');
}
const configured = missing.length === 0;

/** The library is imported at runtime, not by the bundler: `dist/` does not exist before a build. */
const DIST_ENTRY = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

/** Mirrors the library's region derivation, so the derived CDN host can be asserted. */
function regionOf(endpoint: string | undefined): string | undefined {
  if (!endpoint) return undefined;
  const host = endpoint.split(':')[0];
  for (const suffix of ['-fds.api.xiaomi.net', '.fds.api.xiaomi.com', '.mi-fds.com']) {
    if (host.endsWith(suffix)) return host.slice(0, -suffix.length);
  }
  return undefined;
}

const SERVICE_HOST: string | undefined = FDS_BASE_URI
  ? new URL(FDS_BASE_URI).host
  : FDS_ENDPOINT
    ? FDS_ENDPOINT.split(':')[0]
    : FDS_REGION
      ? `${FDS_REGION}.fds.api.xiaomi.com`
      : undefined;
const VIRTUAL_HOSTED = SERVICE_HOST?.endsWith('.mi-fds.com') ?? false;
const REGION = FDS_REGION ?? regionOf(FDS_ENDPOINT ?? SERVICE_HOST);

/**
 * `cdn.cnbj1.fds.api.mi-img.com` for `cnbj1.fds.api.xiaomi.com`. The library
 * derives no CDN host for virtual-hosted (`*.mi-fds.com`) endpoints or for a
 * bare `baseUri`, which is exactly when this is undefined.
 */
const CDN_HOST = FDS_CDN_BASE_URI
  ? new URL(FDS_CDN_BASE_URI).host
  : !FDS_BASE_URI && !VIRTUAL_HOSTED && REGION
    ? `cdn.${REGION}.fds.api.mi-img.com`
    : undefined;
const cdnAvailable = CDN_HOST !== undefined;

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=UTF-8',
  '.md': 'text/markdown; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain; charset=UTF-8',
};

// The reason is part of the suite name so a skipped run says why, instead of
// only printing "1 skipped".
const TITLE = configured
  ? 'integration: live FDS requests'
  : `integration: live FDS requests [skipped: set ${missing.join(', ')}]`;

const CDN_TITLE = cdnAvailable
  ? `downloads over the CDN (${CDN_HOST})`
  : 'downloads over the CDN [skipped: no CDN host — set FDS_CDN_BASE_URI]';

describe.skipIf(!configured)(TITLE, () => {
  let signer: FdsSigner;
  let source: string;
  let temporary = false;
  let body: Uint8Array;
  let contentType: string;
  let object: string;
  /** Every object this run creates, for best-effort cleanup. */
  const created = new Set<string>();

  beforeAll(async () => {
    if (!existsSync(DIST_ENTRY)) {
      throw new Error(
        `missing ${DIST_ENTRY}; run \`npm run build\` (or \`npm run test:integration\`)`,
      );
    }
    const lib = (await import(/* @vite-ignore */ `file://${DIST_ENTRY}`)) as Lib;
    signer = lib.createSigner({
      accessId: FDS_ACCESS_ID!,
      accessSecret: FDS_ACCESS_SECRET!,
      ...(FDS_BASE_URI
        ? { baseUri: FDS_BASE_URI }
        : FDS_ENDPOINT
          ? { endpoint: FDS_ENDPOINT }
          : { regionName: FDS_REGION! }),
      ...(FDS_CDN_BASE_URI ? { cdnBaseUri: FDS_CDN_BASE_URI } : {}),
    });

    if (FDS_UPLOAD_FILE) {
      source = FDS_UPLOAD_FILE;
    } else {
      source = join(tmpdir(), `galaxy-fds-signer-${Date.now()}.txt`);
      await writeFile(source, `galaxy-fds-signer integration test\n${new Date().toISOString()}\n`);
      temporary = true;
    }
    // A plain Uint8Array, not a Buffer: Vitest compares the two as different
    // types, and `Buffer` would also drag in its pooled backing store.
    body = new Uint8Array(await readFile(source));
    contentType = CONTENT_TYPES[extname(source).toLowerCase()] ?? 'application/octet-stream';
    object = `integration/${Date.now()}-${basename(source)}`;
    created.add(object);
  });

  afterAll(async () => {
    // `signer` is unset when `beforeAll` failed (e.g. `dist/` is missing); the
    // temp file still has to go.
    if (signer) {
      for (const name of created) {
        // Best effort: a failed DELETE must not hide the assertion that failed first.
        const del = await signer.signRequest({
          method: 'DELETE',
          bucket: FDS_BUCKET!,
          object: name,
        });
        await fetch(del.url, del).catch(() => undefined);
      }
    }
    if (temporary) {
      await rm(source, { force: true });
    }
  });

  it('uploads the local file', async () => {
    const put = await signer.signRequest({
      method: 'PUT',
      bucket: FDS_BUCKET!,
      object,
      headers: {
        'content-type': contentType,
        'x-xiaomi-meta-uploaded-by': 'galaxy-fds-signer',
      },
    });
    expect(put.method).toBe('PUT');
    expect(put.headers.authorization).toMatch(/^Galaxy-V2 /);
    // The returned header set is exactly what FDS expects to receive.
    expect(put.headers['x-xiaomi-date']).toBeDefined();
    expect(new URL(put.url).host).toBe(SERVICE_HOST);

    const putRes = await checkOk(
      await fetch(put.url, { method: put.method, headers: put.headers, body }),
      `PUT ${put.url}`,
    );
    // FDS answers with `{ objectName, ... }`; there is no etag field in the body
    // (the Java SDK's PutObjectResult does not model one either).
    const uploaded = (await putRes.json()) as { objectName?: string };
    expect(uploaded.objectName).toBe(object);
  });

  it('reads it back over the service endpoint', async () => {
    const get = await signer.signRequest({ bucket: FDS_BUCKET!, object });
    const getRes = await checkOk(await fetch(get.url, get), `GET ${get.url}`);
    expect(getRes.headers.get('content-type')).toBe(contentType);
    expect(bufferOf(await getRes.arrayBuffer())).toEqual(body);

    const head = await signer.signRequest({ method: 'HEAD', bucket: FDS_BUCKET!, object });
    const headRes = await checkOk(await fetch(head.url, head), `HEAD ${head.url}`);
    expect(headRes.headers.get('content-length')).toBe(String(body.byteLength));
  });

  it('reads the object metadata sub-resource', async () => {
    // The payload shape is the Java SDK's business; what this checks is that
    // FDS accepts a signature over a value-less `?metadata` sub-resource.
    const meta = await signer.signRequest({
      bucket: FDS_BUCKET!,
      object,
      subResources: ['metadata'],
    });
    const res = await checkOk(await fetch(meta.url, meta), `GET ${meta.url}`);
    expect(res.status).toBe(200);
    expect(new URL(meta.url).search).toBe('?metadata');
    // Drain the body so the connection is reusable.
    await res.text();
  });

  it('lists objects with unsigned query parameters', async () => {
    // `prefix` and `maxKeys` are sent but not signed, unlike sub-resources.
    const list = await signer.signRequest({
      bucket: FDS_BUCKET!,
      query: { prefix: object, maxKeys: 10 },
    });
    expect(list.url).toContain('?prefix=');
    expect(list.url).toContain('maxKeys=10');

    const res = await checkOk(await fetch(list.url, list), `GET ${list.url}`);
    expect(res.headers.get('content-type')).toMatch(/json/i);
    const text = await res.text();
    expect(text, text).toContain(object);
  });

  it('uploads through a pre-signed URL', async () => {
    const target = `integration/${Date.now()}-presigned.txt`;
    created.add(target);
    const payload = patternedBytes(4096, 7);

    // What a browser gets from the server: no credentials, no secret.
    const signed = await signer.presign({
      method: 'PUT',
      bucket: FDS_BUCKET!,
      object: target,
      headers: { 'content-type': 'text/plain; charset=UTF-8' },
      expiresIn: 300,
    });
    expect(new URL(signed.url).searchParams.get('Signature')).toBeTruthy();
    expect(signed.headers).toEqual({ 'content-type': 'text/plain; charset=UTF-8' });

    const putRes = await checkOk(
      await fetch(signed.url, {
        method: signed.method,
        headers: signed.headers,
        body: payload,
      }),
      `presigned PUT ${signed.url}`,
    );
    await putRes.text();

    const get = await signer.signRequest({ bucket: FDS_BUCKET!, object: target });
    const getRes = await checkOk(await fetch(get.url, get), `GET ${get.url}`);
    expect(bufferOf(await getRes.arrayBuffer())).toEqual(payload);

    const del = await signer.signRequest({ method: 'DELETE', bucket: FDS_BUCKET!, object: target });
    await checkOk(await fetch(del.url, del), `DELETE ${del.url}`);
  });

  it('completes a multipart upload', async () => {
    const target = `integration/${Date.now()}-multipart.bin`;
    created.add(target);
    // A single part is also the last part, so it is exempt from any
    // minimum-part-size rule: a small payload proves the same signatures. Only
    // the part count differs from a real multi-part upload; the shapes (an
    // `?uploadId=&partNumber=` signature and the `{ uploadPartResultList }`
    // body) are identical.
    const part = patternedBytes(PART_BYTES, 11);

    const uploadId = await initMultipart(signer, FDS_BUCKET!, target);
    const result = await uploadPart(signer, FDS_BUCKET!, target, uploadId, 1, part);

    const done = await signer.signRequest({
      method: 'PUT',
      bucket: FDS_BUCKET!,
      object: target,
      subResources: { uploadId },
      headers: { 'content-type': 'application/octet-stream' },
    });
    const body = JSON.stringify({ uploadPartResultList: [result] });
    await checkOk(
      await fetch(done.url, { method: done.method, headers: done.headers, body }),
      `complete ${done.url}`,
    );

    const get = await signer.signRequest({ bucket: FDS_BUCKET!, object: target });
    const getRes = await checkOk(await fetch(get.url, get), `GET ${get.url}`);
    expect(bufferOf(await getRes.arrayBuffer())).toEqual(part);

    const del = await signer.signRequest({ method: 'DELETE', bucket: FDS_BUCKET!, object: target });
    await checkOk(await fetch(del.url, del), `DELETE ${del.url}`);
  });

  it('aborts a multipart upload', async () => {
    const target = `integration/${Date.now()}-aborted.bin`;
    const uploadId = await initMultipart(signer, FDS_BUCKET!, target);
    await uploadPart(signer, FDS_BUCKET!, target, uploadId, 1, patternedBytes(1024, 5));

    const abort = await signer.signRequest({
      method: 'DELETE',
      bucket: FDS_BUCKET!,
      object: target,
      subResources: { uploadId },
      headers: { 'content-type': 'application/json; charset=UTF-8' },
    });
    const res = await checkOk(await fetch(abort.url, abort), `abort ${abort.url}`);
    await res.text();
  });

  it.skipIf(!cdnAvailable)(CDN_TITLE, async () => {
    // The CDN authorizes with the credentials in the query string: it never
    // sees the `Authorization` header the service endpoint uses.
    const cdn = await signer.presign({
      method: 'GET',
      bucket: FDS_BUCKET!,
      object,
      cdn: true,
      expiresIn: 300,
    });
    expect(new URL(cdn.url).host).toBe(CDN_HOST);
    expect(cdn.headers).toEqual({});

    const res = await fetch(cdn.url, { method: cdn.method });
    if (!res.ok) {
      throw new Error(
        `CDN GET failed: ${res.status} ${await res.text()}\n` +
          `  url: ${cdn.url}\n` +
          '  check that the bucket has CDN / outside access enabled, that the object\n' +
          '  has been refreshed (refreshObject) and that FDS_CDN_BASE_URI is right',
      );
    }
    expect(res.headers.get('content-length')).toBe(String(body.byteLength));
    expect(bufferOf(await res.arrayBuffer())).toEqual(body);
  });

  it('deletes the object', async () => {
    const del = await signer.signRequest({ method: 'DELETE', bucket: FDS_BUCKET!, object });
    const delRes = await checkOk(await fetch(del.url, del), `DELETE ${del.url}`);
    expect(delRes.status).toBe(200);

    // Gone for real: the cleanup in `afterAll` becomes a harmless redundant DELETE.
    const gone = await signer.signRequest({ method: 'HEAD', bucket: FDS_BUCKET!, object });
    expect((await fetch(gone.url, gone)).status).toBe(404);
  });
});

/** `PUT ?uploads`, returning the upload id FDS assigns. */
async function initMultipart(signer: FdsSigner, bucket: string, object: string): Promise<string> {
  const init = await signer.signRequest({
    method: 'PUT',
    bucket,
    object,
    subResources: ['uploads'],
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
  const res = await checkOk(await fetch(init.url, init), `init ${init.url}`);
  const text = await res.text();
  let uploadId: unknown;
  try {
    uploadId = (JSON.parse(text) as { uploadId?: unknown }).uploadId;
  } catch {
    // Fall through to the assertion below, which prints the body.
  }
  expect(typeof uploadId === 'string' && uploadId !== '', text).toBe(true);
  return uploadId as string;
}

/** `PUT ?uploadId=…&partNumber=…`; the result is opaque and goes to `complete`. */
async function uploadPart(
  signer: FdsSigner,
  bucket: string,
  object: string,
  uploadId: string,
  partNumber: number,
  bytes: Uint8Array,
): Promise<unknown> {
  const part = await signer.signRequest({
    method: 'PUT',
    bucket,
    object,
    subResources: { uploadId, partNumber },
    headers: { 'content-type': 'application/octet-stream' },
  });
  const res = await checkOk(
    await fetch(part.url, { method: part.method, headers: part.headers, body: bytes }),
    `part ${partNumber} ${part.url}`,
  );
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`part ${partNumber} returned a non-JSON body: ${text}`);
  }
}

/**
 * Fails with the FDS error payload, which is far more useful than the status
 * alone. Reading the body only on failure keeps it available to the caller.
 */
async function checkOk(res: Response, what: string): Promise<Response> {
  if (!res.ok) {
    throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
  }
  return res;
}

/**
 * Deterministic pseudo-random bytes, so a payload cannot be compressed away.
 * `Math.imul` keeps the multiply exact: plain `*` overflows 2^53 and the low
 * bits — the only ones used — are lost, which collapses the sequence.
 */
function patternedBytes(size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size);
  let state = seed;
  for (let i = 0; i < size; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    out[i] = state & 0xff;
  }
  return out;
}

/** `Uint8Array`, not `Buffer`: Vitest's deep equality treats the two as different types. */
function bufferOf(data: ArrayBuffer): Uint8Array {
  return new Uint8Array(data);
}
