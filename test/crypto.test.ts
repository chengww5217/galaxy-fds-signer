import { createHash, createHmac, randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createHmac as createKeyedHmac, hmac, toBase64 } from '../src/auth/crypto.js';
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

describe('hmac key caching', () => {
  it('a keyed HMAC imports its key once and matches hmac()', async () => {
    const spy = vi.spyOn(globalThis.crypto.subtle, 'importKey');
    try {
      const mac = createKeyedHmac(SignAlgorithm.HmacSHA1, 'k');
      expect(spy).not.toHaveBeenCalled(); // imported lazily
      const results = await Promise.all([mac('m1'), mac('m2'), mac('m1')]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(toBase64(results[0])).toBe(toBase64(await hmac(SignAlgorithm.HmacSHA1, 'k', 'm1')));
      expect(toBase64(results[2])).toBe(toBase64(results[0]));
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps no state between keyed HMACs or one-shot calls', async () => {
    const spy = vi.spyOn(globalThis.crypto.subtle, 'importKey');
    try {
      await hmac(SignAlgorithm.HmacSHA1, 'k', 'm');
      await hmac(SignAlgorithm.HmacSHA1, 'k', 'm');
      await createKeyedHmac(SignAlgorithm.HmacSHA1, 'k')('m');
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
    }
  });

  it('HmacMD5 needs no Web Crypto', async () => {
    const mac = createKeyedHmac(SignAlgorithm.HmacMD5, 'k');
    vi.stubGlobal('crypto', undefined);
    try {
      expect(toBase64(await mac('m'))).toBe(createHmac('md5', 'k').update('m').digest('base64'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('retries after a failed import', async () => {
    const importKey = vi.fn(() => Promise.reject(new Error('boom')));
    vi.stubGlobal('crypto', { subtle: { importKey } });
    try {
      const mac = createKeyedHmac(SignAlgorithm.HmacSHA1, 'flaky-key');
      await expect(mac('m')).rejects.toThrow('boom');
      await expect(mac('m')).rejects.toThrow('boom');
      expect(importKey).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
