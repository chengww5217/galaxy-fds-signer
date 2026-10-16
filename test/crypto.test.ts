import { createHash, createHmac, randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createHmac as createKeyedHmac, hmac, toBase64 } from '../src/auth/crypto.js';
import { hmacMd5, md5 } from '../src/auth/md5.js';
import { SignAlgorithm } from '../src/index.js';
import { hasNodeFastPath, stubGetBuiltinModule, usePortableCrypto } from './portable-crypto.js';

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

describe('hmac key caching (without the Node fast path)', () => {
  it('a keyed HMAC imports its key once and matches hmac()', async () => {
    const restore = usePortableCrypto();
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
      restore();
    }
  });

  it('keeps no state between keyed HMACs or one-shot calls', async () => {
    const restore = usePortableCrypto();
    const spy = vi.spyOn(globalThis.crypto.subtle, 'importKey');
    try {
      await hmac(SignAlgorithm.HmacSHA1, 'k', 'm');
      await hmac(SignAlgorithm.HmacSHA1, 'k', 'm');
      await createKeyedHmac(SignAlgorithm.HmacSHA1, 'k')('m');
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
      restore();
    }
  });

  it('HmacMD5 needs no Web Crypto', async () => {
    const restore = usePortableCrypto();
    const mac = createKeyedHmac(SignAlgorithm.HmacMD5, 'k');
    vi.stubGlobal('crypto', undefined);
    try {
      expect(toBase64(await mac('m'))).toBe(createHmac('md5', 'k').update('m').digest('base64'));
    } finally {
      vi.unstubAllGlobals();
      restore();
    }
  });

  it('retries after a failed import', async () => {
    const restore = usePortableCrypto();
    const importKey = vi.fn(() => Promise.reject(new Error('boom')));
    vi.stubGlobal('crypto', { subtle: { importKey } });
    try {
      const mac = createKeyedHmac(SignAlgorithm.HmacSHA1, 'flaky-key');
      await expect(mac('m')).rejects.toThrow('boom');
      await expect(mac('m')).rejects.toThrow('boom');
      expect(importKey).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      restore();
    }
  });
});

describe('node:crypto fast path', () => {
  it.skipIf(!hasNodeFastPath)('is used on Node.js', async () => {
    const proc = (globalThis as { process: { getBuiltinModule: (id: string) => unknown } }).process;
    const spy = vi.spyOn(proc, 'getBuiltinModule');
    try {
      await hmac(SignAlgorithm.HmacSHA1, 'k', 'm');
      expect(spy).toHaveBeenCalledWith('node:crypto');
    } finally {
      spy.mockRestore();
    }
  });

  it.skipIf(!hasNodeFastPath)('matches the portable path for every algorithm', async () => {
    const key = 'clé-秘密';
    const message = 'PUT\n\n\n日付\n/b/中文';
    const fast = new Map<string, string>();
    for (const algorithm of Object.values(SignAlgorithm)) {
      fast.set(algorithm, toBase64(await hmac(algorithm, key, message)));
    }
    const restore = usePortableCrypto();
    try {
      for (const algorithm of Object.values(SignAlgorithm)) {
        expect(toBase64(await hmac(algorithm, key, message))).toBe(fast.get(algorithm));
        // The keyed variant picks its strategy at creation time, so it must
        // agree as well after the fallback has been selected.
        expect(toBase64(await createKeyedHmac(algorithm, key)(message))).toBe(fast.get(algorithm));
      }
    } finally {
      restore();
    }
  });

  it.skipIf(!hasNodeFastPath)('reuses a keyed HMAC across messages', async () => {
    const mac = createKeyedHmac(SignAlgorithm.HmacSHA1, 'k');
    const oracle = (m: string) => createHmac('sha1', 'k').update(m, 'utf-8').digest('base64');
    // The probe Hmac serves the first message; the rest must sign with fresh
    // ones, including when several calls are in flight at once.
    const results = await Promise.all([mac('m1'), mac('m2'), mac('m3')]);
    expect(results.map(toBase64)).toEqual(['m1', 'm2', 'm3'].map(oracle));
    expect(toBase64(await mac('m4'))).toBe(oracle('m4'));
  });

  it('falls back when the native digest is unavailable (e.g. FIPS)', async () => {
    const restore = stubGetBuiltinModule({
      createHmac: () => {
        throw new Error('digest disabled by policy');
      },
    });
    try {
      expect(toBase64(await hmac(SignAlgorithm.HmacMD5, 'k', 'm'))).toBe(
        createHmac('md5', 'k').update('m', 'utf-8').digest('base64'),
      );
      expect(toBase64(await hmac(SignAlgorithm.HmacSHA1, 'k', 'm'))).toBe(
        createHmac('sha1', 'k').update('m', 'utf-8').digest('base64'),
      );
    } finally {
      restore();
    }
  });

  it('ignores a getBuiltinModule that resolves to nothing usable', async () => {
    const expected = createHmac('sha1', 'k').update('m', 'utf-8').digest('base64');
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error('locked down');
        },
      },
    );
    for (const module of [
      null,
      42,
      {},
      { createHmac: 'not a function' },
      { createHmac: () => null },
      { createHmac: () => undefined },
      { createHmac: () => ({}) },
      { createHmac: () => ({ update: () => 'nope', digest: 42 }) },
      hostile,
    ]) {
      const restore = stubGetBuiltinModule(module);
      try {
        expect(toBase64(await hmac(SignAlgorithm.HmacSHA1, 'k', 'm'))).toBe(expected);
      } finally {
        restore();
      }
    }
  });
});
