import { describe, expect, it } from 'vitest';

import { HeaderMultiMap } from '../src/auth/signer.js';
import { GalaxyFDSClientException, HttpMethod, Signer } from '../src/index.js';

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
      generatePresignedUri(
        'http://files.fds.api.xiaomi.com/',
        'my-bucket',
        'my-object',
        null,
        1700000000000,
        HttpMethod.GET,
        ACCESS_ID,
        ACCESS_SECRET,
      ),
    ).toContain('Signature=');
  });
});

describe('generatePresignedUri input validation', () => {
  function presign(expiration: Date | number, bucketName = 'my-bucket'): string {
    return Signer.generatePresignedUri(
      'http://files.fds.api.xiaomi.com/',
      bucketName,
      'my-object',
      null,
      expiration,
      HttpMethod.GET,
      ACCESS_ID,
      ACCESS_SECRET,
    );
  }

  it('rejects an empty bucket name', () => {
    expect(() => presign(1700000000000, '')).toThrow(GalaxyFDSClientException);
    expect(() => presign(1700000000000, '')).toThrow('bucketName');
  });

  it.each([NaN, Infinity, -Infinity, new Date('not a date')])(
    'rejects an invalid expiration: %s',
    (expiration) => {
      expect(() => presign(expiration)).toThrow(GalaxyFDSClientException);
      expect(() => presign(expiration)).toThrow('expiration');
    },
  );
});

describe('HeaderMultiMap', () => {
  it('looks up values by exact key, preserving insertion order', () => {
    const map = new HeaderMultiMap();
    map.put('X-Xiaomi-Date', 'v1');
    map.put('x-xiaomi-date', 'v2');
    expect(map.get('X-Xiaomi-Date')).toEqual(['v1']);
    expect(map.get('x-xiaomi-date')).toEqual(['v2']);
    expect(map.get('X-XIAOMI-DATE')).toEqual([]);
    expect(map.getFirst('x-xiaomi-date')).toBe('v2');
    expect(map.entries()).toEqual([
      ['X-Xiaomi-Date', 'v1'],
      ['x-xiaomi-date', 'v2'],
    ]);
  });

  it('builds from a plain object with single or array values', () => {
    const map = HeaderMultiMap.from({
      'content-type': 'text/plain',
      'x-xiaomi-meta-tags': ['a', 'b'],
    });
    expect(map.getFirst('content-type')).toBe('text/plain');
    expect(map.getFirst('Content-Type')).toBe('');
    expect(map.get('x-xiaomi-meta-tags')).toEqual(['a', 'b']);
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
