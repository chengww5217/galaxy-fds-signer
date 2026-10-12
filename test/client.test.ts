import { describe, expect, it } from 'vitest';

import {
  BasicFDSCredential,
  Common,
  GalaxyFDSClient,
  GalaxyFDSClientException,
  HttpMethod,
  Signer,
  SubResource,
} from '../src/index.js';

const ACCESS_ID = 'AKIDEXAMPLEACCESSID';
const ACCESS_SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY';

function newClient() {
  return new GalaxyFDSClient(new BasicFDSCredential(ACCESS_ID, ACCESS_SECRET));
}

describe('GalaxyFDSClient', () => {
  it('builds an authorization header matching the Signer', () => {
    const client = newClient();
    const uri = Common.DEFAULT_FDS_SERVICE_BASE_URI + 'my-bucket/my-object';
    const headers = { date: 'Sun, 06 Nov 1994 08:49:37 GMT' };
    const expected = Signer.getAuthorizationHeader(
      HttpMethod.GET,
      uri,
      headers,
      ACCESS_ID,
      ACCESS_SECRET,
    );
    expect(client.getAuthorizationHeader(HttpMethod.GET, uri, headers)).toBe(expected);
  });

  it('defaults the pre-signed URI to the FDS base and GET', () => {
    const client = newClient();
    const uri = client.generatePresignedUri('my-bucket', 'my-object', 1700000000000);
    expect(uri.startsWith(Common.DEFAULT_FDS_SERVICE_BASE_URI + 'my-bucket/my-object?')).toBe(true);
    expect(uri).toContain(`${Common.GALAXY_ACCESS_KEY_ID}=${ACCESS_ID}`);
    expect(uri).toContain(`${Common.EXPIRES}=1700000000000`);
    expect(uri).toContain(`${Common.SIGNATURE}=`);
  });

  it('accepts a Date expiration equivalently to epoch millis', () => {
    const client = newClient();
    const millis = 1700000000000;
    const fromDate = client.generatePresignedUri('b', 'o', new Date(millis));
    const fromMillis = client.generatePresignedUri('b', 'o', millis);
    expect(fromDate).toBe(fromMillis);
  });

  it('includes a SubResource fragment in the pre-signed URI', () => {
    const client = newClient();
    const uri = client.generatePresignedUri('b', 'o', 1700000000000, HttpMethod.GET, [
      SubResource.ACL,
    ]);
    expect(uri).toContain('/b/o?acl&');
  });

  it('uses the CDN base for generatePresignedCdnUri', () => {
    const client = newClient();
    const uri = client.generatePresignedCdnUri('b', 'o', 1700000000000);
    expect(uri.startsWith(Common.DEFAULT_CDN_SERVICE_URI)).toBe(true);
  });

  it('honors custom base URIs from options', () => {
    const client = new GalaxyFDSClient(new BasicFDSCredential(ACCESS_ID, ACCESS_SECRET), {
      baseUri: 'https://my.endpoint.example.com/',
    });
    const uri = client.generatePresignedUri('b', 'o', 1700000000000);
    expect(uri.startsWith('https://my.endpoint.example.com/b/o?')).toBe(true);
  });

  it('accepts a plain { accessId, accessSecret } credential', () => {
    const plain = new GalaxyFDSClient({ accessId: ACCESS_ID, accessSecret: ACCESS_SECRET });
    const uri = Common.DEFAULT_FDS_SERVICE_BASE_URI + 'my-bucket/my-object';
    const headers = { date: 'Sun, 06 Nov 1994 08:49:37 GMT' };
    expect(plain.getAuthorizationHeader(HttpMethod.GET, uri, headers)).toBe(
      newClient().getAuthorizationHeader(HttpMethod.GET, uri, headers),
    );
    expect(plain.generatePresignedUri('b', 'o', 1700000000000)).toBe(
      newClient().generatePresignedUri('b', 'o', 1700000000000),
    );
  });

  it('rejects a credential with neither credential shape', () => {
    expect(() => new GalaxyFDSClient({} as never)).toThrow(GalaxyFDSClientException);
    expect(() => new GalaxyFDSClient({ accessId: ACCESS_ID } as never)).toThrow('credential');
  });

  it('supports an options object equivalent to the positional form', () => {
    const client = newClient();
    const viaOptions = client.generatePresignedUri('b', 'o', 1700000000000, {
      method: HttpMethod.PUT,
      contentType: 'image/png',
      contentMD5: '1B2M2Y8AsgTpgAmY7PhCfg==',
    });
    const viaPositional = client.generatePresignedUri(
      'b',
      'o',
      1700000000000,
      HttpMethod.PUT,
      null,
      'image/png',
      '1B2M2Y8AsgTpgAmY7PhCfg==',
    );
    expect(viaOptions).toBe(viaPositional);
  });

  it('accepts a plain string as the method in the options object', () => {
    const client = newClient();
    expect(client.generatePresignedUri('b', 'o', 1700000000000, { method: 'PUT' })).toBe(
      client.generatePresignedUri('b', 'o', 1700000000000, HttpMethod.PUT),
    );
  });

  it('accepts sub-resources in the options object', () => {
    const client = newClient();
    expect(client.generatePresignedUri('b', 'o', 1700000000000, { subResources: ['acl'] })).toBe(
      client.generatePresignedUri('b', 'o', 1700000000000, HttpMethod.GET, [SubResource.ACL]),
    );
  });

  it('supports an options object for CDN pre-signing', () => {
    const client = newClient();
    const viaOptions = client.generatePresignedCdnUri('b', 'o', 1700000000000, { method: 'HEAD' });
    const viaPositional = client.generatePresignedCdnUri('b', 'o', 1700000000000, HttpMethod.HEAD);
    expect(viaOptions).toBe(viaPositional);
  });
});
