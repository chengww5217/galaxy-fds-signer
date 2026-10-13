import { createHash, createHmac, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hmac, toBase64 } from '../src/auth/crypto.js';
import { hmacMd5, md5 } from '../src/auth/md5.js';
import { SignAlgorithm } from '../src/index.js';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('portable MD5 / HMAC-MD5', () => {
  // Lengths around the 55/56/64-byte padding boundaries matter most.
  const lengths = [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000];

  it.each(lengths)('md5 matches node:crypto for %i bytes', (n) => {
    const data = randomBytes(n);
    expect(hex(md5(data))).toBe(createHash('md5').update(data).digest('hex'));
  });

  it.each([0, 16, 64, 65, 200])('hmacMd5 matches node:crypto for a %i-byte key', (n) => {
    const key = randomBytes(n);
    const msg = randomBytes(100);
    expect(hex(hmacMd5(key, msg))).toBe(createHmac('md5', key).update(msg).digest('hex'));
  });

  it('matches the RFC 1321 test vectors', () => {
    const enc = new TextEncoder();
    expect(hex(md5(enc.encode('')))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hex(md5(enc.encode('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72');
  });
});

describe('hmac()', () => {
  it.each([
    [SignAlgorithm.HmacSHA1, 'sha1'],
    [SignAlgorithm.HmacSHA256, 'sha256'],
    [SignAlgorithm.HmacMD5, 'md5'],
  ] as const)('%s matches node:crypto on UTF-8 input', async (algorithm, digest) => {
    const key = 'clé-秘密';
    const msg = 'PUT\n\n\n日付\n/b/中文';
    expect(toBase64(await hmac(algorithm, key, msg))).toBe(
      createHmac(digest, key).update(msg, 'utf-8').digest('base64'),
    );
  });
});
