/**
 * Minimal MD5 (RFC 1321) over bytes.
 *
 * Web Crypto does not offer MD5, but Galaxy FDS supports `HmacMD5`, so this
 * small implementation keeps that algorithm working on runtimes without
 * `node:crypto` (Cloudflare Workers, Vercel Edge, browsers). It is only used
 * as the hash inside HMAC, never on its own.
 */

// Per-round left-rotation amounts.
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(abs(sin(i + 1)) * 2^32)
const K = Array.from(
  { length: 64 },
  (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
);

/** Returns the 16-byte MD5 digest of `data`. */
export function md5(data: Uint8Array): Uint8Array {
  // Pad: 0x80, zeros, then the 64-bit little-endian bit length.
  const paddedLength = (((data.length + 8) >>> 6) + 1) << 6;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(data);
  buffer[data.length] = 0x80;
  const view = new DataView(buffer.buffer);
  const bitLength = data.length * 8;
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const m = new Uint32Array(16);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let j = 0; j < 16; j++) {
      m[j] = view.getUint32(offset + j * 4, true);
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      const sum = (a + f + K[i] + m[g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0 >>> 0, true);
  outView.setUint32(4, b0 >>> 0, true);
  outView.setUint32(8, c0 >>> 0, true);
  outView.setUint32(12, d0 >>> 0, true);
  return out;
}

/** HMAC-MD5 (RFC 2104) with a 64-byte block size. */
export function hmacMd5(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  let k = key.length > blockSize ? md5(key) : key;
  const padded = new Uint8Array(blockSize);
  padded.set(k);
  k = padded;

  const inner = new Uint8Array(blockSize + message.length);
  const outer = new Uint8Array(blockSize + 16);
  for (let i = 0; i < blockSize; i++) {
    inner[i] = k[i] ^ 0x36;
    outer[i] = k[i] ^ 0x5c;
  }
  inner.set(message, blockSize);
  outer.set(md5(inner), blockSize);
  return md5(outer);
}
