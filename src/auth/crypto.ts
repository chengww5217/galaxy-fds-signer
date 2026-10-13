import { SignAlgorithm } from '../enums.js';
import { GalaxyFDSSignerError } from '../errors.js';
import { hmacMd5 } from './md5.js';

/**
 * Portable crypto and encoding primitives built only on Web-standard APIs
 * (`crypto.subtle`, `TextEncoder`, `btoa`), so the library runs unchanged on
 * Node.js, Deno, Bun, Cloudflare Workers, Vercel Edge and browsers.
 */

const encoder = new TextEncoder();

/** UTF-8 encodes a string. */
export function utf8(s: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(s);
}

/** Standard (padded) Base64 of `bytes`. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Web Crypto hash names for the algorithms Web Crypto supports. */
const SUBTLE_HASH: Partial<Record<SignAlgorithm, string>> = {
  [SignAlgorithm.HmacSHA1]: 'SHA-1',
  [SignAlgorithm.HmacSHA256]: 'SHA-256',
};

/**
 * The Web Crypto `SubtleCrypto` surface, derived from `globalThis` so the type
 * does not depend on the bare `Crypto` / `SubtleCrypto` globals: only newer
 * `@types/node` versions expose those, while v22 keeps them module-scoped.
 */
type SubtleCryptoLike = typeof globalThis.crypto.subtle;

/** The `CryptoKey` `importKey` resolves to, derived from `globalThis`. */
type HmacKey = Awaited<ReturnType<SubtleCryptoLike['importKey']>>;

function subtle(): SubtleCryptoLike {
  const s = (globalThis as { crypto?: { subtle?: SubtleCryptoLike } }).crypto?.subtle;
  if (s === undefined) {
    throw new GalaxyFDSSignerError(
      'CRYPTO_UNAVAILABLE',
      'Web Crypto (globalThis.crypto.subtle) is not available in this runtime',
    );
  }
  return s;
}

/**
 * A keyed HMAC: signs messages with one (algorithm, secret) pair. See
 * {@link createHmac}.
 */
export type Hmac = (message: string) => Promise<Uint8Array>;

/**
 * Binds `HMAC(algorithm, key, ·)` to a key, so `crypto.subtle.importKey` runs
 * once per keyed HMAC rather than on every message (it roughly halves the cost
 * of a signature). The imported key lives in this closure only, so it is
 * released together with whoever holds the returned function, e.g. a signer.
 * A failed import is not kept: the next call retries.
 */
export function createHmac(algorithm: SignAlgorithm, key: string): Hmac {
  const hash = SUBTLE_HASH[algorithm];
  if (hash === undefined) {
    // Web Crypto has no MD5; HmacMD5 is the only algorithm that lands here.
    const keyBytes = utf8(key);
    return async (message) => hmacMd5(keyBytes, utf8(message));
  }
  let imported: Promise<HmacKey> | undefined;
  return async (message) => {
    if (imported === undefined) {
      const pending = subtle().importKey('raw', utf8(key), { name: 'HMAC', hash }, false, ['sign']);
      imported = pending;
      pending.catch(() => {
        if (imported === pending) {
          imported = undefined;
        }
      });
    }
    const cryptoKey = await imported;
    return new Uint8Array(await subtle().sign('HMAC', cryptoKey, utf8(message)));
  };
}

/** Computes `HMAC(algorithm, key, message)` once; see {@link createHmac} to reuse a key. */
export function hmac(algorithm: SignAlgorithm, key: string, message: string): Promise<Uint8Array> {
  return createHmac(algorithm, key)(message);
}
