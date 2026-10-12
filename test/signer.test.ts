import { describe, expect, it } from 'vitest';

import { HttpMethod, Signer } from '../src/index.js';

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
