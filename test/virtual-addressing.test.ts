import { describe, expect, it } from 'vitest';

import { createSigner, GalaxyFDSSignerError, type SignerOptions } from '../src/index.js';

const CREDENTIAL = {
  accessId: 'AKIDEXAMPLEACCESSID',
  accessSecret: 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
};
const EXPIRES = 4102444800000; // 2100-01-01

const signerFor = (options: Omit<SignerOptions, 'accessId' | 'accessSecret'>) =>
  createSigner({ ...CREDENTIAL, ...options });
const virtual = signerFor({ endpoint: 'files.mi-fds.com' });
const presignUrl = async (signer: typeof virtual, bucket: string, object = 'o') =>
  (await signer.presign({ bucket, object, expires: EXPIRES })).url;
const signatureOf = (url: string) => new URL(url).searchParams.get('Signature');

describe('virtual-hosted-style addressing', () => {
  it('puts the bucket in the subdomain of a pre-signed URL', async () => {
    // The bucket stays in the path as well, matching the Java SDK.
    expect(await presignUrl(virtual, 'my-bucket', 'my-object')).toMatch(
      /^https:\/\/my-bucket\.files\.mi-fds\.com\/my-bucket\/my-object\?/,
    );
  });

  it('puts the bucket in the subdomain of a signed request', async () => {
    const req = await virtual.signRequest({ bucket: 'my-bucket', object: 'my-object' });
    expect(req.url).toBe('https://my-bucket.files.mi-fds.com/my-bucket/my-object');
  });

  it('produces the same signature as the non-virtual host', async () => {
    const plain = signerFor({ baseUri: 'https://files.mi-fds.com/' });
    expect(signatureOf(await presignUrl(virtual, 'my-bucket'))).toBe(
      signatureOf(await presignUrl(plain, 'my-bucket')),
    );
  });

  it('does not rewrite non-virtual endpoints', async () => {
    const signer = signerFor({ endpoint: 'files.fds.api.xiaomi.com' });
    expect(await presignUrl(signer, 'my-bucket')).toMatch(
      /^https:\/\/files\.fds\.api\.xiaomi\.com\/my-bucket\/o\?/,
    );
  });

  it('does not rewrite when an explicit base URI points elsewhere', async () => {
    const signer = signerFor({
      endpoint: 'files.mi-fds.com',
      baseUri: 'https://other.example.com/',
    });
    expect(await presignUrl(signer, 'my-bucket')).toMatch(
      /^https:\/\/other\.example\.com\/my-bucket\/o\?/,
    );
  });

  it('rejects CDN targets without a CDN endpoint', async () => {
    await expect(
      virtual.presign({ bucket: 'b', object: 'o', cdn: true, expires: EXPIRES }),
    ).rejects.toThrow(GalaxyFDSSignerError);
  });
});

describe('bucket name validation', () => {
  it.each(['a.b', 'x@evil.com', 'a:1', '-ab', 'ab-', 'a'.repeat(64), 'a b'])(
    'rejects %j as a virtual-hosted bucket',
    async (bucket) => {
      await expect(presignUrl(virtual, bucket)).rejects.toThrow(GalaxyFDSSignerError);
      await expect(virtual.signRequest({ bucket })).rejects.toThrow(GalaxyFDSSignerError);
    },
  );

  it.each(['a', 'my-bucket', 'B1', 'a'.repeat(63)])(
    'accepts %j as a virtual-hosted bucket',
    async (b) => {
      expect(await presignUrl(virtual, b)).toMatch(
        new RegExp(`^https://${b.toLowerCase()}\\.files\\.mi-fds\\.com/${b}/o\\?`),
      );
    },
  );

  it('rejects a slash in any bucket name', async () => {
    await expect(presignUrl(signerFor({}), 'a/b')).rejects.toThrow(/must not contain/);
  });

  it('allows dotted bucket names with path-style addressing', async () => {
    expect(await presignUrl(signerFor({}), 'a.b')).toContain('/a.b/o?');
  });
});
