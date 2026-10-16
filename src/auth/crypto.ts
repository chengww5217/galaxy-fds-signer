import { SignAlgorithm } from '../enums.js';
import { GalaxyFDSSignerError } from '../errors.js';
import { hmacMd5 } from './md5.js';

/**
 * Portable crypto and encoding primitives built on Web-standard APIs
 * (`crypto.subtle`, `TextEncoder`, `btoa`), so the library runs unchanged on
 * Node.js, Deno, Bun, Cloudflare Workers, Vercel Edge and browsers. Where the
 * runtime provides `node:crypto` there is additionally a native fast path; see
 * {@link nodeCrypto}.
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

/** `node:crypto` digest names, for the native fast path. */
const NODE_DIGEST: Partial<Record<SignAlgorithm, string>> = {
  [SignAlgorithm.HmacMD5]: 'md5',
  [SignAlgorithm.HmacSHA1]: 'sha1',
  [SignAlgorithm.HmacSHA256]: 'sha256',
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

/** The part of a `node:crypto` Hmac used by the fast path. */
interface NodeHmac {
  update(data: Uint8Array): NodeHmac;
  digest(): Uint8Array;
}

/** The part of the `node:crypto` module used by the fast path. */
interface NodeCrypto {
  createHmac(algorithm: string, key: Uint8Array): NodeHmac;
}

/**
 * `node:crypto` when the runtime provides it (Node.js >= 22.3, Bun), or
 * `undefined` otherwise.
 *
 * `process.getBuiltinModule` is a plain function call, not an `import`, so the
 * bundle carries no `node:*` specifier and still loads on Cloudflare Workers,
 * Vercel Edge, Deno, Bun and browsers: a runtime without the method simply
 * falls back to Web Crypto. Node's HMAC is synchronous and avoids the roughly
 * fixed per-call overhead of `crypto.subtle` (about 8 microseconds,
 * independent of the message length), which makes serial signing roughly
 * 2-3x faster.
 *
 * `process` is read off `globalThis` on purpose: the library must not
 * reference the Node global by name, since it does not exist on the edge.
 */
function nodeCrypto(): NodeCrypto | undefined {
  try {
    const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } })
      .process;
    const module = proc?.getBuiltinModule?.('node:crypto') as Partial<NodeCrypto> | undefined;
    return typeof module?.createHmac === 'function' ? (module as NodeCrypto) : undefined;
  } catch {
    // A runtime with a `process` lookalike that cannot resolve builtins.
    return undefined;
  }
}

/**
 * A `node:crypto`-backed HMAC, or `undefined` when the runtime has no Node
 * crypto or its OpenSSL refuses the digest (MD5 under a FIPS policy, say).
 *
 * Unlike the Web Crypto branch there is no key to import and cache: Node's
 * `createHmac` is synchronous and stateless between messages, so every message
 * signs with a fresh Hmac. The first one doubles as the availability probe and
 * is reused for the first message, so probing costs nothing.
 */
function createNodeHmac(digest: string, keyBytes: Uint8Array): Hmac | undefined {
  const crypto = nodeCrypto();
  if (crypto === undefined) {
    return undefined;
  }
  let pending: NodeHmac | undefined;
  try {
    const candidate = crypto.createHmac(digest, keyBytes) as NodeHmac | null | undefined;
    // A digest can be refused (MD5 under FIPS) and a lookalike module can
    // return anything; the shape is checked before the object is trusted.
    if (
      candidate === null ||
      candidate === undefined ||
      typeof candidate.update !== 'function' ||
      typeof candidate.digest !== 'function'
    ) {
      return undefined;
    }
    pending = candidate;
  } catch {
    return undefined;
  }
  return async (message) => {
    const hmac = pending ?? crypto.createHmac(digest, keyBytes);
    pending = undefined;
    return new Uint8Array(hmac.update(utf8(message)).digest());
  };
}

/**
 * A keyed HMAC: signs messages with one (algorithm, secret) pair. See
 * {@link createHmac}.
 */
export type Hmac = (message: string) => Promise<Uint8Array>;

/**
 * Binds `HMAC(algorithm, key, ·)` to a key.
 *
 * When the runtime provides `node:crypto` (Node.js >= 22.3, Bun), the
 * returned function signs with its native HMAC (see {@link nodeCrypto});
 * otherwise it uses Web Crypto — importing the key once rather than on every
 * message, which roughly halves the cost of a signature — or the portable MD5
 * where Web Crypto has none. The key lives in this closure only, so it is
 * released together with whoever holds the returned function, e.g. a signer.
 *
 * An implementation that cannot run is not kept: a failed `crypto.subtle`
 * import is retried on the next call, and an unavailable native digest (MD5
 * under FIPS) selects the fallback instead of failing.
 */
export function createHmac(algorithm: SignAlgorithm, key: string): Hmac {
  const keyBytes = utf8(key);
  const digest = NODE_DIGEST[algorithm];
  const fast = digest === undefined ? undefined : createNodeHmac(digest, keyBytes);
  if (fast !== undefined) {
    return fast;
  }
  const hash = SUBTLE_HASH[algorithm];
  if (hash === undefined) {
    // Web Crypto has no MD5; HmacMD5 is the only algorithm that lands here.
    return async (message) => hmacMd5(keyBytes, utf8(message));
  }
  let imported: Promise<HmacKey> | undefined;
  return async (message) => {
    if (imported === undefined) {
      const pending = subtle().importKey('raw', keyBytes, { name: 'HMAC', hash }, false, ['sign']);
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
