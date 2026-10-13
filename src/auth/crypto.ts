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

function subtle(): SubtleCrypto {
  const s = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (s === undefined) {
    throw new GalaxyFDSSignerError(
      'Web Crypto (globalThis.crypto.subtle) is not available in this runtime',
    );
  }
  return s;
}

/** Computes `HMAC(algorithm, key, message)`. */
export async function hmac(
  algorithm: SignAlgorithm,
  key: string,
  message: string,
): Promise<Uint8Array> {
  const keyBytes = utf8(key);
  const messageBytes = utf8(message);
  const hash = SUBTLE_HASH[algorithm];
  if (hash === undefined) {
    // Web Crypto has no MD5; HmacMD5 is the only algorithm that lands here.
    return hmacMd5(keyBytes, messageBytes);
  }
  const cryptoKey = await subtle().importKey('raw', keyBytes, { name: 'HMAC', hash }, false, [
    'sign',
  ]);
  return new Uint8Array(await subtle().sign('HMAC', cryptoKey, messageBytes));
}
