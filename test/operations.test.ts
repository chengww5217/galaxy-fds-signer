/**
 * Every FDS operation listed in docs/operations.md, checked against the
 * official Java SDK.
 *
 * test/fixtures/operations.json was produced by driving the real
 * galaxy-fds-sdk-java 3.0.48 GalaxyFDSClient against a local capture server
 * (recording the method, path and query it sends for each operation), then
 * signing those requests with the Java Signer. For each operation we check
 * that signRequest builds the same URL and signature, and, for operations
 * that can be pre-signed, that presign matches Java's generatePresignedUri.
 */
import { describe, expect, it } from 'vitest';

import operations from './fixtures/operations.json' with { type: 'json' };
import { createSigner, type PresignInput, type SignRequestInput } from '../src/index.js';

interface Operation {
  group: string;
  javaMethod: string;
  input: Record<string, unknown> & { headers?: Record<string, string> };
  presignable: boolean;
  javaPath: string;
  javaSignature: string;
  javaPresignedSignature?: string;
}

const ACCESS_ID = 'AKIDEXAMPLEACCESSID';
const signer = createSigner({
  accessId: ACCESS_ID,
  accessSecret: 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
  endpoint: 'cnbj1.fds.api.xiaomi.com',
});
const DATE = new Date('1994-11-06T08:49:37Z');
const EXPIRES = 4102444800000;
const ops = operations as Operation[];

describe('FDS operations — parity with the galaxy-fds-sdk-java client', () => {
  it('covers every documented operation', () => {
    expect(ops.length).toBe(57);
  });

  describe.each(ops)('$javaMethod', (op) => {
    it('signRequest builds the same URL and signature', async () => {
      const req = await signer.signRequest({ ...op.input, date: DATE } as SignRequestInput);
      expect(req.method).toBe(op.input.method);
      expect(req.url).toBe('https://cnbj1.fds.api.xiaomi.com' + op.javaPath);
      expect(req.headers.authorization).toBe(`Galaxy-V2 ${ACCESS_ID}:${op.javaSignature}`);
    });

    if (op.presignable) {
      it('presign produces the same signature', async () => {
        // Pre-signable operations carry no unsigned query parameters.
        expect(op.input.query).toBeUndefined();
        const req = await signer.presign({ ...op.input, expires: EXPIRES } as PresignInput);
        const url = new URL(req.url);
        expect(url.searchParams.get('Signature')).toBe(op.javaPresignedSignature);
        expect(req.headers).toEqual(op.input.headers ?? {});
      });
    }
  });
});
