import { describe, expect, it } from 'vitest';

import {
  createSigner,
  GalaxyFDSSignerError,
  presign,
  SignAlgorithm,
  type SignerOptions,
  signRequest,
  SubResource,
} from '../src/index.js';

const ACCESS_ID = 'AKIDEXAMPLEACCESSID';
const ACCESS_SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY';
const DATE = new Date('1994-11-06T08:49:37Z');
const FUTURE = 4102444800000; // 2100-01-01

const OPTIONS: SignerOptions = {
  accessId: ACCESS_ID,
  accessSecret: ACCESS_SECRET,
  endpoint: 'cnbj1.fds.api.xiaomi.com',
};
const signer = createSigner(OPTIONS);

const signatureOf = (url: string) => new URL(url).searchParams.get('Signature');

// Expected values were produced by galaxy-fds-sdk-java 3.0.48 from the same
// URL and headers.
describe('signRequest — parity with the Java SDK', () => {
  it('signs a GET of an object with non-ASCII / space characters', async () => {
    const req = await signer.signRequest({
      bucket: 'my-bucket',
      object: 'dir/中文 file.png',
      date: DATE,
    });
    expect(req).toEqual({
      url: 'https://cnbj1.fds.api.xiaomi.com/my-bucket/dir/%E4%B8%AD%E6%96%87%20file.png',
      method: 'GET',
      headers: {
        'x-xiaomi-date': 'Sun, 06 Nov 1994 08:49:37 GMT',
        authorization: `Galaxy-V2 ${ACCESS_ID}:gO5+7ZV6dztNOcJZpGijDPTfwbQ=`,
      },
    });
  });

  it('signs a multipart part upload with sub-resources, headers and HmacSHA256', async () => {
    const req = await createSigner({ ...OPTIONS, algorithm: SignAlgorithm.HmacSHA256 }).signRequest(
      {
        method: 'put',
        bucket: 'my-bucket',
        object: 'big.bin',
        subResources: { uploadId: 'u/1', partNumber: 3 },
        headers: { 'Content-Type': 'application/octet-stream', 'X-Xiaomi-Meta-Owner': 'alice' },
        date: DATE,
      },
    );
    expect(req.method).toBe('PUT');
    expect(req.url).toBe(
      'https://cnbj1.fds.api.xiaomi.com/my-bucket/big.bin?uploadId=u%2F1&partNumber=3',
    );
    expect(req.headers).toEqual({
      'content-type': 'application/octet-stream',
      'x-xiaomi-meta-owner': 'alice',
      'x-xiaomi-date': 'Sun, 06 Nov 1994 08:49:37 GMT',
      authorization: `Galaxy-V2 ${ACCESS_ID}:Z3NociJDkpTTKJx76Vfsl75bsN6IpPeqT3fspriXQ6Y=`,
    });
  });

  it('sends extra query parameters without signing them', async () => {
    const req = await signer.signRequest({
      bucket: 'my-bucket',
      query: { prefix: 'a/', maxKeys: 10 },
      date: DATE,
    });
    expect(req.url).toBe('https://cnbj1.fds.api.xiaomi.com/my-bucket?prefix=a%2F&maxKeys=10');
    expect(req.headers.authorization).toBe(`Galaxy-V2 ${ACCESS_ID}:pzKets7fTM9U/UN93vWCflb4iLI=`);
  });
});

describe('presign — parity with the Java SDK', () => {
  it('pre-signs a PUT with HmacMD5', async () => {
    const req = await createSigner({ ...OPTIONS, algorithm: 'HmacMD5' }).presign({
      method: 'PUT',
      bucket: 'my-bucket',
      object: 'dir/中文 file.png',
      expires: FUTURE,
    });
    // Java renders the path as `dir/中文%20file.png`; both decode to the
    // same signed path, and fetch needs the fully encoded form.
    expect(req.url).toBe(
      'https://cnbj1.fds.api.xiaomi.com/my-bucket/dir/%E4%B8%AD%E6%96%87%20file.png' +
        `?GalaxyAccessKeyId=${ACCESS_ID}&Expires=${FUTURE}&Signature=fXlOlpKW19QUG%2FJJVEhBYA%3D%3D`,
    );
    expect(req).toMatchObject({ method: 'PUT', headers: {}, expiresAt: FUTURE });
  });
});

describe('signRequest', () => {
  it('returns plain JSON-serializable data usable as fetch init', async () => {
    const req = await signer.signRequest({ bucket: 'b', object: 'o', date: DATE });
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
    // `new Request` accepts it as-is: url + { method, headers }.
    const request = new Request(req.url, req);
    expect(request.method).toBe('GET');
    expect(request.headers.get('authorization')).toBe(req.headers.authorization);
  });

  it('defaults the date to now', async () => {
    const before = Date.now() - 1000;
    const req = await signer.signRequest({ bucket: 'b', object: 'o' });
    const sent = Date.parse(req.headers['x-xiaomi-date']);
    expect(sent).toBeGreaterThanOrEqual(before);
    expect(sent).toBeLessThanOrEqual(Date.now());
  });

  it('keeps a caller-supplied date or x-xiaomi-date header', async () => {
    const withDate = await signer.signRequest({
      bucket: 'b',
      headers: { Date: DATE.toUTCString() },
    });
    expect(withDate.headers).toEqual({
      date: DATE.toUTCString(),
      authorization: expect.stringMatching(/^Galaxy-V2 /),
    });
    const withXiaomi = await signer.signRequest({
      bucket: 'b',
      headers: new Headers({ 'X-Xiaomi-Date': 'x' }),
    });
    expect(withXiaomi.headers['x-xiaomi-date']).toBe('x');
  });

  it('signs and returns trimmed header values, so the request verifies after fetch', async () => {
    const padded = await signer.signRequest({
      bucket: 'b',
      headers: { 'x-xiaomi-meta-a': '  v\t' },
      date: DATE,
    });
    const clean = await signer.signRequest({
      bucket: 'b',
      headers: { 'x-xiaomi-meta-a': 'v' },
      date: DATE,
    });
    expect(padded).toEqual(clean);
  });

  it('signs well-formed astral characters (surrogate pairs)', async () => {
    const req = await signer.signRequest({ bucket: 'b', object: '😀.png', date: DATE });
    expect(req.url).toBe('https://cnbj1.fds.api.xiaomi.com/b/%F0%9F%98%80.png');
  });

  it('is deterministic for the same input', async () => {
    const input = { method: 'DELETE', bucket: 'b', object: 'o', date: DATE } as const;
    expect(await signer.signRequest(input)).toEqual(await signer.signRequest(input));
  });

  it('signs an explicit URL', async () => {
    const url = 'https://cnbj1.fds.api.xiaomi.com/my-bucket/dir/%E4%B8%AD%E6%96%87%20file.png';
    const req = await signer.signRequest({ url, date: DATE });
    expect(req.url).toBe(url);
    expect(req.headers.authorization).toBe(`Galaxy-V2 ${ACCESS_ID}:gO5+7ZV6dztNOcJZpGijDPTfwbQ=`);
  });

  it('signs service-level requests without a bucket', async () => {
    const req = await signer.signRequest({ date: DATE });
    expect(req.url).toBe('https://cnbj1.fds.api.xiaomi.com/');
  });

  it('targets the CDN endpoint on request', async () => {
    const req = await signer.signRequest({ bucket: 'b', object: 'o', cdn: true });
    expect(req.url).toBe('https://cdn.cnbj1.fds.api.mi-img.com/b/o');
  });

  it('one-shot helpers reject (not throw) on configuration errors', async () => {
    const pending = signRequest({ accessId: '', accessSecret: 's' }, {});
    await expect(pending).rejects.toThrow(GalaxyFDSSignerError);
    await expect(presign({ accessId: '', accessSecret: 's' }, { bucket: 'b' })).rejects.toThrow(
      GalaxyFDSSignerError,
    );
  });

  it('defaults to the public endpoint when none is configured', async () => {
    const req = await signRequest(
      { accessId: ACCESS_ID, accessSecret: ACCESS_SECRET },
      { bucket: 'b', object: 'o' },
    );
    expect(req.url).toBe('http://files.fds.api.xiaomi.com/b/o');
  });

  it.each([
    ['an unsupported method', { method: 'PATCH' }],
    [
      'a duplicate header',
      {
        headers: [
          ['x-xiaomi-meta-a', '1'],
          ['X-Xiaomi-Meta-A', '2'],
        ],
      },
    ],
    ['an object without bucket', { object: 'o' }],
    ['a bucket containing "/"', { bucket: 'a/b' }],
    ['an unknown sub-resource', { bucket: 'b', subResources: { foo: 1 } }],
    ['an invalid date', { bucket: 'b', date: new Date(NaN) }],
    ['an invalid url', { url: 'not a url' }],
    ['a relative url', { url: '/b/o' }],
    ['url combined with bucket', { url: 'https://h/b/o', bucket: 'b' }],
    ['url combined with query', { url: 'https://h/b/o', query: { a: 1 } }],
    ['headers that are not an object', { headers: 42 }],
    ['headers given as a string', { headers: 'content-type' }],
    ['a non-string header value', { headers: { 'content-length': 5 } }],
    ['malformed header pairs', { headers: [['a']] }],
    ['an invalid header name', { headers: { 'bad name': 'v' } }],
    ['a header value with a line break', { headers: { 'x-xiaomi-meta-a': 'a\r\nb' } }],
    ['a non-string object name', { bucket: 'b', object: 5 }],
    ['a non-scalar sub-resource value', { bucket: 'b', subResources: { uploadId: {} } }],
    ['a non-object query', { bucket: 'b', query: 'a=1' }],
    ['a non-scalar query value', { bucket: 'b', query: { a: {} } }],
    ['a sub-resource passed as query', { bucket: 'b', query: { uploadId: 'x' } }],
    ['Expires passed as query', { bucket: 'b', query: { Expires: '9999999999999' } }],
    ['Signature passed as query (any case)', { bucket: 'b', query: { signature: 'x' } }],
    ['a query value with a lone surrogate', { bucket: 'b', query: { prefix: 'a\udfff' } }],
    ['a query name with a lone surrogate', { bucket: 'b', query: { ['\ud800']: '1' } }],
    ['a url with a lone surrogate', { url: 'https://h/b/\ud800' }],
    ['no input', undefined],
  ])('rejects %s', async (_name, input) => {
    await expect(signer.signRequest(input as never)).rejects.toThrow(GalaxyFDSSignerError);
  });
});

describe('presign', () => {
  it('defaults to GET and a 15 minute lifetime', async () => {
    const before = Date.now();
    const req = await signer.presign({ bucket: 'b', object: 'o' });
    expect(req.method).toBe('GET');
    expect(req.expiresAt).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
    expect(req.expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
    expect(new URL(req.url).searchParams.get('Expires')).toBe(String(req.expiresAt));
  });

  it('honors expiresIn (seconds)', async () => {
    const req = await signer.presign({ bucket: 'b', object: 'o', expiresIn: 60 });
    expect(req.expiresAt - Date.now()).toBeLessThanOrEqual(60_000);
    expect(req.expiresAt - Date.now()).toBeGreaterThan(55_000);
  });

  it('returns the signed headers the client must send', async () => {
    const plain = await signer.presign({
      method: 'PUT',
      bucket: 'b',
      object: 'o',
      expires: FUTURE,
    });
    const typed = await signer.presign({
      method: 'PUT',
      bucket: 'b',
      object: 'o',
      expires: FUTURE,
      headers: { 'Content-Type': 'image/png' },
    });
    expect(typed.headers).toEqual({ 'content-type': 'image/png' });
    expect(signatureOf(typed.url)).not.toBe(signatureOf(plain.url));
  });

  it('includes sub-resources', async () => {
    const req = await signer.presign({
      bucket: 'b',
      object: 'o',
      subResources: [SubResource.ACL],
      expires: FUTURE,
    });
    expect(req.url).toContain('/b/o?acl&GalaxyAccessKeyId=');
  });

  it('pre-signs CDN URLs', async () => {
    const req = await presign(OPTIONS, { bucket: 'b', object: 'o', cdn: true, expires: FUTURE });
    expect(req.url.startsWith('https://cdn.cnbj1.fds.api.mi-img.com/b/o?')).toBe(true);
  });

  it('matches the signature of the equivalent signRequest URL on another host', async () => {
    const other = createSigner({ ...OPTIONS, endpoint: undefined, baseUri: 'http://x.example/' });
    const a = await signer.presign({ bucket: 'b', object: 'o', expires: FUTURE });
    const b = await other.presign({ bucket: 'b', object: 'o', expires: FUTURE });
    expect(signatureOf(a.url)).toBe(signatureOf(b.url));
  });

  it.each([
    ['a missing bucket', {}],
    ['a past expiration', { bucket: 'b', expires: Date.now() - 1000 }],
    ['an expiration in seconds', { bucket: 'b', expires: Math.floor(FUTURE / 1000) }],
    ['a non-positive expiresIn', { bucket: 'b', expiresIn: 0 }],
    ['a NaN expiresIn', { bucket: 'b', expiresIn: NaN }],
    ['a non-boolean cdn', { bucket: 'b', cdn: 1 }],
    ['an object with a lone surrogate', { bucket: 'b', object: 'a\ud800' }],
    ['a bucket with a lone surrogate', { bucket: '\udc00b' }],
    [
      'a sub-resource value with a lone surrogate',
      { bucket: 'b', subResources: { uploadId: '\ud83d' } },
    ],
    ['an Infinity expiresIn', { bucket: 'b', expiresIn: Infinity }],
    ['no input', undefined],
  ])('rejects %s', async (_name, input) => {
    await expect(signer.presign(input as never)).rejects.toThrow(GalaxyFDSSignerError);
  });
});

describe('default bucket', () => {
  const withBucket = createSigner({ ...OPTIONS, bucket: 'my-bucket' });

  it('signRequest falls back to the configured bucket', async () => {
    const implicit = await withBucket.signRequest({ object: 'o', date: DATE });
    const explicit = await signer.signRequest({ bucket: 'my-bucket', object: 'o', date: DATE });
    expect(implicit).toEqual(explicit);
  });

  it('signRequest lets a bucket override the configured one', async () => {
    const req = await withBucket.signRequest({ bucket: 'other', object: 'o', date: DATE });
    expect(req.url).toBe('https://cnbj1.fds.api.xiaomi.com/other/o');
  });

  it('presign falls back to the configured bucket', async () => {
    const implicit = await withBucket.presign({ object: 'o', expires: FUTURE });
    const explicit = await signer.presign({ bucket: 'my-bucket', object: 'o', expires: FUTURE });
    expect(implicit).toEqual(explicit);
  });

  it('presign lets a bucket override the configured one', async () => {
    const req = await withBucket.presign({ bucket: 'other', object: 'o', expires: FUTURE });
    expect(new URL(req.url).pathname).toBe('/other/o');
  });

  it('signs a service-level request through an explicit url', async () => {
    const req = await withBucket.signRequest({
      url: 'https://cnbj1.fds.api.xiaomi.com/',
      date: DATE,
    });
    expect(req.url).toBe('https://cnbj1.fds.api.xiaomi.com/');
  });
});

describe('createSigner', () => {
  it.each([
    ['no options', undefined],
    ['a missing secret', { accessId: ACCESS_ID }],
    ['an empty access id', { accessId: '', accessSecret: ACCESS_SECRET }],
    ['an unknown algorithm', { ...OPTIONS, algorithm: 'HmacSHA512' }],
    ['an unrecognized endpoint', { ...OPTIONS, endpoint: 'example.com' }],
    ['an invalid baseUri', { ...OPTIONS, baseUri: 'nope' }],
    ['an invalid default bucket', { ...OPTIONS, bucket: 'a/b' }],
  ])('throws synchronously for %s', (_name, options) => {
    expect(() => createSigner(options as never)).toThrow(GalaxyFDSSignerError);
  });

  it('exposes the access id but not the secret', () => {
    expect(signer.accessId).toBe(ACCESS_ID);
    expect(Object.keys(signer).sort()).toEqual(['accessId', 'presign', 'signRequest']);
    expect(Object.isFrozen(signer)).toBe(true);
  });

  it('works when methods are destructured', async () => {
    const { signRequest: sign } = signer;
    await expect(sign({ bucket: 'b' })).resolves.toHaveProperty('url');
  });
});
