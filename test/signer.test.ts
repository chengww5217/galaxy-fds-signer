import { describe, expect, it } from 'vitest';

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
