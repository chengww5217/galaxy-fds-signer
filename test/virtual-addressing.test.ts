import { describe, expect, it } from 'vitest';

import {
  BasicFDSCredential,
  GalaxyFDSSigner,
  GalaxyFDSSignerError,
  HttpMethod,
  Signer,
} from '../src/index.js';

const ACCESS_ID = 'AKIDEXAMPLEACCESSID';
const ACCESS_SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY';
const EXPIRES = 4102444800000; // 2100-01-01

function newVirtualClient() {
  return new GalaxyFDSSigner(new BasicFDSCredential(ACCESS_ID, ACCESS_SECRET), {
    endpoint: 'files.mi-fds.com',
  });
}

function signatureOf(uri: string): string {
  return uri.slice(uri.indexOf('Signature='));
}

describe('virtual-hosted-style addressing', () => {
  it('puts the bucket in the subdomain of a pre-signed URI', () => {
    const client = newVirtualClient();
    const uri = client.generatePresignedUri('my-bucket', 'my-object', EXPIRES);
    // The bucket stays in the path as well, matching the Java SDK.
    expect(uri.startsWith('https://my-bucket.files.mi-fds.com/my-bucket/my-object?')).toBe(true);
  });

  it('produces the same signature as the non-virtual host', () => {
    const client = newVirtualClient();
    const virtual = client.generatePresignedUri('my-bucket', 'my-object', EXPIRES);
    const plain = Signer.generatePresignedUri(
      'https://files.mi-fds.com/',
      'my-bucket',
      'my-object',
      undefined,
      EXPIRES,
      HttpMethod.GET,
      ACCESS_ID,
      ACCESS_SECRET,
    );
    expect(signatureOf(virtual)).toBe(signatureOf(plain));
  });

  it('does not rewrite non-virtual endpoints', () => {
    const client = new GalaxyFDSSigner(new BasicFDSCredential(ACCESS_ID, ACCESS_SECRET), {
      endpoint: 'files.fds.api.xiaomi.com',
    });
    const uri = client.generatePresignedUri('my-bucket', 'my-object', EXPIRES);
    expect(uri.startsWith('https://files.fds.api.xiaomi.com/my-bucket/my-object?')).toBe(true);
  });

  it('does not rewrite when an explicit base URI points elsewhere', () => {
    const client = new GalaxyFDSSigner(new BasicFDSCredential(ACCESS_ID, ACCESS_SECRET), {
      endpoint: 'files.mi-fds.com',
      baseUri: 'https://other.example.com/',
    });
    const uri = client.generatePresignedUri('my-bucket', 'my-object', EXPIRES);
    expect(uri.startsWith('https://other.example.com/my-bucket/my-object?')).toBe(true);
  });

  it('rejects pre-signing a CDN URI without a CDN endpoint', () => {
    const client = newVirtualClient();
    expect(() => client.generatePresignedCdnUri('my-bucket', 'my-object', EXPIRES)).toThrow(
      GalaxyFDSSignerError,
    );
  });
});
