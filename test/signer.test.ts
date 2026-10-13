import { describe, expect, it } from 'vitest';

import { HeaderMultiMap } from '../src/auth/signer.js';
import { GalaxyFDSSignerError, HttpMethod, Signer } from '../src/index.js';

const ACCESS_ID = 'AKIDEXAMPLEACCESSID';
const ACCESS_SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY';
const URI = 'http://files.fds.api.xiaomi.com/my-bucket/my-object';
const HEADERS = { date: 'Sun, 06 Nov 1994 08:49:37 GMT' };

describe('Signer API', () => {
  it('keeps methods functional when destructured (no reliance on this)', () => {
    const { sign, signToBase64, getAuthorizationHeader, generatePresignedUri } = Signer;

    const signature = sign(HttpMethod.GET, URI, HEADERS, ACCESS_SECRET).toString('base64');
    expect(signToBase64(HttpMethod.GET, URI, HEADERS, ACCESS_SECRET)).toBe(signature);
    expect(getAuthorizationHeader(HttpMethod.GET, URI, HEADERS, ACCESS_ID, ACCESS_SECRET)).toBe(
      `Galaxy-V2 ${ACCESS_ID}:${signature}`,
    );
    expect(
      generatePresignedUri({
        baseUri: 'http://files.fds.api.xiaomi.com/',
        bucketName: 'my-bucket',
        objectName: 'my-object',
        expiration: 1700000000000,
        accessId: ACCESS_ID,
        accessSecret: ACCESS_SECRET,
      }),
    ).toContain('Signature=');
  });
});

describe('method and algorithm validation', () => {
  it('normalizes a lower-case method to upper case', () => {
    expect(Signer.signToBase64('get' as HttpMethod, URI, HEADERS, ACCESS_SECRET)).toBe(
      Signer.signToBase64(HttpMethod.GET, URI, HEADERS, ACCESS_SECRET),
    );
  });

  it.each(['PATCH', '', 42])('rejects unsupported method %j', (method) => {
    expect(() => Signer.signToBase64(method as HttpMethod, URI, HEADERS, ACCESS_SECRET)).toThrow(
      GalaxyFDSSignerError,
    );
  });

  it.each(['HmacSHA512', 'sha1', 'toString'])('rejects unsupported algorithm %j', (algorithm) => {
    expect(() =>
      Signer.signToBase64(HttpMethod.GET, URI, HEADERS, ACCESS_SECRET, algorithm as never),
    ).toThrow(GalaxyFDSSignerError);
  });
});

describe('getAuthorizationHeader date requirement', () => {
  it.each([[{}], [{ 'content-type': 'text/plain' }]])(
    'rejects a request without date headers: %j',
    (headers) => {
      expect(() =>
        Signer.getAuthorizationHeader(HttpMethod.GET, URI, headers, ACCESS_ID, ACCESS_SECRET),
      ).toThrow(/date/);
    },
  );

  it.each([[{ Date: 'd' }], [{ 'X-Xiaomi-Date': 'd' }]])('accepts %j', (headers) => {
    expect(
      Signer.getAuthorizationHeader(HttpMethod.GET, URI, headers, ACCESS_ID, ACCESS_SECRET),
    ).toMatch(/^Galaxy-V2 /);
  });
});

describe('generatePresignedUri input validation', () => {
  function presign(expiration: Date | number, bucketName = 'my-bucket'): string {
    return Signer.generatePresignedUri({
      baseUri: 'http://files.fds.api.xiaomi.com/',
      bucketName,
      objectName: 'my-object',
      expiration,
      accessId: ACCESS_ID,
      accessSecret: ACCESS_SECRET,
    });
  }

  it('rejects an empty bucket name', () => {
    expect(() => presign(1700000000000, '')).toThrow(GalaxyFDSSignerError);
    expect(() => presign(1700000000000, '')).toThrow('bucketName');
  });

  it.each([NaN, Infinity, -Infinity, new Date('not a date'), 1.5e12 + 0.5, '1700000000000'])(
    'rejects an invalid expiration: %s',
    (expiration) => {
      expect(() => presign(expiration as number)).toThrow(GalaxyFDSSignerError);
      expect(() => presign(expiration as number)).toThrow('expiration');
    },
  );

  it.each([0, -1, 1700000000])('rejects a non-millisecond expiration: %s', (expiration) => {
    expect(() => presign(expiration)).toThrow(/milliseconds/);
  });
});

describe('HeaderMultiMap', () => {
  it('looks up values case-insensitively, preserving insertion order', () => {
    const map = new HeaderMultiMap();
    map.put('X-Xiaomi-Date', 'v1');
    map.put('x-xiaomi-date', 'v2');
    expect(map.get('X-Xiaomi-Date')).toEqual(['v1', 'v2']);
    expect(map.get('X-XIAOMI-DATE')).toEqual(['v1', 'v2']);
    expect(map.getFirst('x-xiaomi-date')).toBe('v1');
    expect(map.has('X-XIAOMI-DATE')).toBe(true);
    expect(map.has('date')).toBe(false);
    expect(map.entries()).toEqual([
      ['x-xiaomi-date', 'v1'],
      ['x-xiaomi-date', 'v2'],
    ]);
  });

  it('builds from a plain object with single or array values', () => {
    const map = HeaderMultiMap.from({
      'Content-Type': 'text/plain',
      'x-xiaomi-meta-tags': ['a', 'b'],
    });
    expect(map.getFirst('content-type')).toBe('text/plain');
    expect(map.getFirst('Content-Type')).toBe('text/plain');
    expect(map.get('x-xiaomi-meta-tags')).toEqual(['a', 'b']);
  });

  it('builds from a WHATWG Headers instance', () => {
    const map = HeaderMultiMap.from(
      new Headers({ 'Content-Type': 'text/plain', 'X-Xiaomi-Acl': 'private' }),
    );
    expect(map.getFirst('content-type')).toBe('text/plain');
    expect(map.getFirst('x-xiaomi-acl')).toBe('private');
  });

  it('builds from a list of [name, value] pairs', () => {
    const map = HeaderMultiMap.from([
      ['X-Xiaomi-Meta-A', '1'],
      ['x-xiaomi-meta-a', '2'],
    ]);
    expect(map.get('x-xiaomi-meta-a')).toEqual(['1', '2']);
  });

  it('from() returns the same instance when given one', () => {
    const map = new HeaderMultiMap();
    expect(HeaderMultiMap.from(map)).toBe(map);
  });

  it('from(undefined) yields an empty map and getFirst defaults to an empty string', () => {
    const map = HeaderMultiMap.from(undefined);
    expect(map.entries()).toEqual([]);
    expect(map.getFirst('missing')).toBe('');
  });
});
