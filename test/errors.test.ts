import { afterEach, describe, expect, it, vi } from 'vitest';

import { FDSEndpointConfiguration } from '../src/config.js';
import { Signer } from '../src/auth/signer.js';
import {
  createSigner,
  ErrorCode,
  GalaxyFDSSignerError,
  type GalaxyFDSSignerErrorCode,
  type GalaxyFDSSignerErrorKind,
  type SignerOptions,
} from '../src/index.js';

const OPTIONS: SignerOptions = {
  accessId: 'id',
  accessSecret: 'secret',
  endpoint: 'cnbj1.fds.api.xiaomi.com',
};
const signer = createSigner(OPTIONS);
const URI = 'http://files.fds.api.xiaomi.com/b/o';
const DATE = { date: 'Sun, 06 Nov 1994 08:49:37 GMT' };

/** Runs `fn` (sync or async) and returns the GalaxyFDSSignerError it throws. */
async function catchError(fn: () => unknown): Promise<GalaxyFDSSignerError> {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GalaxyFDSSignerError);
    return e as GalaxyFDSSignerError;
  }
  throw new Error('expected a GalaxyFDSSignerError');
}

describe('GalaxyFDSSignerError', () => {
  it('carries code, kind, field, message, name and cause', () => {
    const cause = new Error('boom');
    const err = new GalaxyFDSSignerError('INVALID_BUCKET', 'failed', { cause, field: 'bucket' });
    expect(err.message).toBe('failed');
    expect(err.name).toBe('GalaxyFDSSignerError');
    expect(err.code).toBe('INVALID_BUCKET');
    expect(err.kind).toBe('input');
    expect(err.field).toBe('bucket');
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(Error);
  });

  it('omits cause and field when not given', () => {
    const err = new GalaxyFDSSignerError('SIGNING_FAILED', 'x');
    expect(err.cause).toBeUndefined();
    expect(err.field).toBeUndefined();
  });

  it('serializes to JSON without cause or stack', () => {
    const err = new GalaxyFDSSignerError('INVALID_BUCKET', 'bad', {
      cause: new Error('secret detail'),
      field: 'bucket',
    });
    expect(JSON.parse(JSON.stringify(err))).toEqual({
      name: 'GalaxyFDSSignerError',
      code: 'INVALID_BUCKET',
      kind: 'input',
      field: 'bucket',
      message: 'bad',
    });
    expect(new GalaxyFDSSignerError('SIGNING_FAILED', 'x').toJSON()).not.toHaveProperty('field');
  });

  it('ErrorCode maps every code to itself and is frozen', () => {
    for (const [key, value] of Object.entries(ErrorCode)) {
      expect(value).toBe(key);
    }
    expect(Object.isFrozen(ErrorCode)).toBe(true);
  });
});

describe('error codes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const future = () => Date.now() + 60_000;

  const cases: Array<
    [GalaxyFDSSignerErrorCode, GalaxyFDSSignerErrorKind, string | undefined, string, () => unknown]
  > = [
    ['INVALID_OPTIONS', 'config', 'options', 'null options', () => createSigner(null as never)],
    [
      'INVALID_CREDENTIALS',
      'config',
      'accessId',
      'empty accessId',
      () => createSigner({ ...OPTIONS, accessId: '' }),
    ],
    [
      'INVALID_CREDENTIALS',
      'config',
      'accessSecret',
      'non-string accessSecret',
      () => createSigner({ ...OPTIONS, accessSecret: 42 as never }),
    ],
    [
      'INVALID_CREDENTIALS',
      'config',
      'accessSecret',
      'empty secret in low-level sign',
      () => Signer.signToBase64('GET', URI, DATE, ''),
    ],
    [
      'UNSUPPORTED_ALGORITHM',
      'config',
      'algorithm',
      'unknown algorithm',
      () => createSigner({ ...OPTIONS, algorithm: 'HmacSHA512' as never }),
    ],
    [
      'INVALID_BUCKET_OPTION',
      'config',
      'bucket',
      'default bucket with a slash',
      () => createSigner({ ...OPTIONS, bucket: 'a/b' }),
    ],
    [
      'INVALID_BUCKET_OPTION',
      'config',
      'bucket',
      'non-DNS default bucket with virtual addressing',
      () => createSigner({ ...OPTIONS, endpoint: 'cnbj1.mi-fds.com', bucket: 'a.b' }),
    ],
    [
      'INVALID_ENDPOINT',
      'config',
      'endpoint',
      'unknown endpoint suffix',
      () => createSigner({ ...OPTIONS, endpoint: 'example.com' }),
    ],
    [
      'INVALID_ENDPOINT',
      'config',
      'endpoint',
      'non-string endpoint',
      () => createSigner({ ...OPTIONS, endpoint: 42 as never }),
    ],
    [
      'INVALID_ENDPOINT',
      'config',
      'baseUri',
      'relative baseUri',
      () => createSigner({ accessId: 'id', accessSecret: 's', baseUri: 'nope' }),
    ],
    [
      'INVALID_ENDPOINT',
      'config',
      'baseUri',
      'invalid low-level base URI',
      () =>
        Signer.generatePresignedUri({
          baseUri: 'nope',
          bucketName: 'b',
          expiration: 4102444800000,
          accessId: 'id',
          accessSecret: 's',
        }),
    ],
    [
      'CDN_NOT_CONFIGURED',
      'config',
      'cdn',
      'cdn on a virtual-hosted endpoint',
      () =>
        createSigner({ ...OPTIONS, endpoint: 'cnbj1.mi-fds.com' }).signRequest({
          bucket: 'b',
          cdn: true,
        }),
    ],
    [
      'UNSUPPORTED_METHOD',
      'input',
      'method',
      'unknown method',
      () => signer.signRequest({ method: 'PATCH' as never, bucket: 'b' }),
    ],
    [
      'INVALID_INPUT',
      'input',
      'input',
      'missing signRequest input',
      () => signer.signRequest(undefined as never),
    ],
    [
      'INVALID_INPUT',
      'input',
      'input',
      'missing presign input',
      () => signer.presign(undefined as never),
    ],
    [
      'INVALID_HEADERS',
      'input',
      'headers',
      'non-object headers',
      () => signer.signRequest({ bucket: 'b', headers: 42 as never }),
    ],
    [
      'INVALID_HEADERS',
      'input',
      'headers',
      'duplicate header',
      () =>
        signer.signRequest({
          bucket: 'b',
          headers: [
            ['x-xiaomi-meta-a', '1'],
            ['X-Xiaomi-Meta-A', '2'],
          ],
        }),
    ],
    [
      'INVALID_HEADERS',
      'input',
      'headers',
      'non-string header value',
      () => signer.presign({ bucket: 'b', headers: { 'content-type': 1 as never } }),
    ],
    [
      'MISSING_DATE',
      'input',
      'headers',
      'no date header in low-level signing',
      () => Signer.getAuthorizationHeader('GET', URI, {}, 'id', 'secret'),
    ],
    [
      'INVALID_BUCKET',
      'input',
      'bucket',
      'missing presign bucket',
      () => signer.presign({} as never),
    ],
    [
      'INVALID_BUCKET',
      'input',
      'bucket',
      'bucket with a slash',
      () => signer.signRequest({ bucket: 'a/b' }),
    ],
    [
      'INVALID_BUCKET',
      'input',
      'bucket',
      'object without bucket',
      () => signer.signRequest({ object: 'o' }),
    ],
    [
      'INVALID_BUCKET',
      'input',
      'bucket',
      'non-DNS bucket with virtual addressing',
      () => createSigner({ ...OPTIONS, endpoint: 'cnbj1.mi-fds.com' }).presign({ bucket: 'a.b' }),
    ],
    [
      'INVALID_BUCKET',
      'input',
      'bucketName',
      'low-level bucket with a slash',
      () =>
        Signer.generatePresignedUri({
          baseUri: 'http://h/',
          bucketName: 'a/b',
          expiration: 4102444800000,
          accessId: 'id',
          accessSecret: 's',
        }),
    ],
    [
      'INVALID_OBJECT',
      'input',
      'object',
      'non-string object',
      () => signer.signRequest({ bucket: 'b', object: 1 as never }),
    ],
    [
      'INVALID_SUB_RESOURCE',
      'input',
      'subResources',
      'unknown sub-resource',
      () => signer.signRequest({ bucket: 'b', subResources: ['prefix' as never] }),
    ],
    [
      'INVALID_SUB_RESOURCE',
      'input',
      'subResources',
      'invalid sub-resource value',
      () => signer.presign({ bucket: 'b', subResources: { uploadId: {} as never } }),
    ],
    [
      'INVALID_QUERY',
      'input',
      'query',
      'non-object query',
      () => signer.signRequest({ bucket: 'b', query: 'a=1' as never }),
    ],
    [
      'INVALID_QUERY',
      'input',
      'query',
      'non-scalar query value',
      () => signer.signRequest({ bucket: 'b', query: { a: {} as never } }),
    ],
    [
      'INVALID_QUERY',
      'input',
      'query',
      'reserved query name',
      () => signer.signRequest({ bucket: 'b', query: { Expires: 1 } }),
    ],
    [
      'INVALID_URL',
      'input',
      'url',
      'url mixed with bucket',
      () => signer.signRequest({ url: URI, bucket: 'b' } as never),
    ],
    ['INVALID_URL', 'input', 'url', 'empty url', () => signer.signRequest({ url: '' })],
    ['INVALID_URL', 'input', 'url', 'relative url', () => signer.signRequest({ url: '/b/o' })],
    [
      'INVALID_URL',
      'input',
      'url',
      'malformed low-level URI',
      () => Signer.signToBase64('GET', 'not a uri', DATE, 'secret'),
    ],
    [
      'INVALID_DATE',
      'input',
      'date',
      'invalid date',
      () => signer.signRequest({ bucket: 'b', date: new Date(NaN) }),
    ],
    [
      'INVALID_EXPIRATION',
      'input',
      'expiresIn',
      'non-positive expiresIn',
      () => signer.presign({ bucket: 'b', expiresIn: 0 }),
    ],
    [
      'INVALID_EXPIRATION',
      'input',
      'expiresIn',
      'expiresIn overflowing a safe integer',
      () => signer.presign({ bucket: 'b', expiresIn: 1e300 }),
    ],
    [
      'INVALID_EXPIRATION',
      'input',
      'expires',
      'expires in seconds',
      () => signer.presign({ bucket: 'b', expires: Math.floor(future() / 1000) }),
    ],
    [
      'INVALID_EXPIRATION',
      'input',
      'expires',
      'fractional expires',
      () => signer.presign({ bucket: 'b', expires: future() + 0.5 }),
    ],
    [
      'INVALID_EXPIRATION',
      'input',
      'expires',
      'expires in the past',
      () => signer.presign({ bucket: 'b', expires: Date.now() - 1000 }),
    ],
    [
      'INVALID_EXPIRATION',
      'input',
      'expiration',
      'low-level expiration in seconds',
      () =>
        Signer.generatePresignedUri({
          baseUri: 'http://h/',
          bucketName: 'b',
          expiration: 1,
          accessId: 'id',
          accessSecret: 's',
        }),
    ],
    [
      'CRYPTO_UNAVAILABLE',
      'runtime',
      undefined,
      'missing Web Crypto',
      () => {
        vi.stubGlobal('crypto', undefined);
        return signer.signRequest({ bucket: 'b' });
      },
    ],
    [
      'SIGNING_FAILED',
      'runtime',
      undefined,
      'Web Crypto failure',
      () => {
        vi.stubGlobal('crypto', {
          subtle: {
            importKey: () => Promise.reject(new Error('boom')),
          },
        });
        return signer.signRequest({ bucket: 'b' });
      },
    ],
  ];

  it.each(cases)('%s (%s, field %s) for %s', async (code, kind, field, _name, fn) => {
    const err = await catchError(fn);
    expect(err.code).toBe(code);
    expect(err.kind).toBe(kind);
    expect(err.field).toBe(field);
  });

  it('covers every error code', () => {
    expect(new Set(cases.map(([code]) => code))).toEqual(new Set(Object.keys(ErrorCode)));
  });

  it('wraps unexpected errors with their cause', async () => {
    vi.stubGlobal('crypto', { subtle: { importKey: () => Promise.reject(new Error('boom')) } });
    const err = await catchError(() => signer.signRequest({ bucket: 'b' }));
    expect(err.message).toBe('failed to sign request: boom');
    expect((err.cause as Error).message).toBe('boom');
  });

  it('does not re-wrap its own errors', async () => {
    const err = await catchError(() =>
      Signer.generatePresignedUri({
        baseUri: 'http://h/',
        bucketName: 'b',
        expiration: 1,
        accessId: 'id',
        accessSecret: 's',
      }),
    );
    expect(err.message).toMatch(/^expiration/);
    expect(err.cause).toBeUndefined();
  });

  it('CDN errors from the configuration carry the code', () => {
    const config = new FDSEndpointConfiguration({ endpoint: 'cnbj1.mi-fds.com' });
    expect(() => config.getCdnBaseUri()).toThrow(
      expect.objectContaining({ code: 'CDN_NOT_CONFIGURED' }),
    );
  });

  it('never puts the secret in a message', async () => {
    const secret = 'S3CR3T-value';
    const s = createSigner({ ...OPTIONS, accessSecret: secret });
    for (const fn of [
      () => s.signRequest({ bucket: 'a/b' }),
      () => s.presign({ bucket: 'b', expiresIn: -1 }),
      () => s.signRequest({ url: 'nope' }),
    ]) {
      const err = await catchError(fn);
      expect(JSON.stringify(err)).not.toContain(secret);
    }
  });
});
