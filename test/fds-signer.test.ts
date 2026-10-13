import { describe, expect, it } from 'vitest';

import {
  BasicFDSCredential,
  GalaxyFDSSigner,
  GalaxyFDSSignerError,
  HttpMethod,
  Signer,
  SubResource,
} from '../src/index.js';
import { Common } from '../src/common.js';

const ACCESS_ID = 'AKIDEXAMPLEACCESSID';
const ACCESS_SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY';
const FUTURE = 4102444800000; // 2100-01-01

function newClient() {
  return new GalaxyFDSSigner(new BasicFDSCredential(ACCESS_ID, ACCESS_SECRET));
}

describe('GalaxyFDSSigner', () => {
  it('builds an authorization header matching the Signer', async () => {
    const client = newClient();
    const uri = Common.DEFAULT_FDS_SERVICE_BASE_URI + 'my-bucket/my-object';
    const headers = { date: 'Sun, 06 Nov 1994 08:49:37 GMT' };
    const expected = await Signer.getAuthorizationHeader(
      HttpMethod.GET,
      uri,
      headers,
      ACCESS_ID,
      ACCESS_SECRET,
    );
    expect(await client.getAuthorizationHeader(HttpMethod.GET, uri, headers)).toBe(expected);
  });

  it('defaults the pre-signed URI to the FDS base and GET', async () => {
    const client = newClient();
    const uri = await client.generatePresignedUri('my-bucket', 'my-object', FUTURE);
    expect(uri.startsWith(Common.DEFAULT_FDS_SERVICE_BASE_URI + 'my-bucket/my-object?')).toBe(true);
    expect(uri).toContain(`${Common.GALAXY_ACCESS_KEY_ID}=${ACCESS_ID}`);
    expect(uri).toContain(`${Common.EXPIRES}=${FUTURE}`);
    expect(uri).toContain(`${Common.SIGNATURE}=`);
  });

  it('accepts a Date expiration equivalently to epoch millis', async () => {
    const client = newClient();
    const millis = FUTURE;
    const fromDate = await client.generatePresignedUri('b', 'o', new Date(millis));
    const fromMillis = await client.generatePresignedUri('b', 'o', millis);
    expect(fromDate).toBe(fromMillis);
  });

  it('includes a SubResource fragment in the pre-signed URI', async () => {
    const client = newClient();
    const uri = await client.generatePresignedUri('b', 'o', FUTURE, {
      subResources: [SubResource.ACL],
    });
    expect(uri).toContain('/b/o?acl&');
  });

  it('rejects an expiration in the past', async () => {
    const client = newClient();
    await expect(client.generatePresignedUri('b', 'o', Date.now() - 1000)).rejects.toThrow(
      'expiration must be in the future',
    );
  });

  it('uses the CDN base for generatePresignedCdnUri', async () => {
    const client = newClient();
    const uri = await client.generatePresignedCdnUri('b', 'o', FUTURE);
    expect(uri.startsWith(Common.DEFAULT_CDN_SERVICE_URI)).toBe(true);
  });

  it('honors custom base URIs from options', async () => {
    const client = new GalaxyFDSSigner(new BasicFDSCredential(ACCESS_ID, ACCESS_SECRET), {
      baseUri: 'https://my.endpoint.example.com/',
    });
    const uri = await client.generatePresignedUri('b', 'o', FUTURE);
    expect(uri.startsWith('https://my.endpoint.example.com/b/o?')).toBe(true);
  });

  it('accepts a plain { accessId, accessSecret } credential', async () => {
    const plain = new GalaxyFDSSigner({ accessId: ACCESS_ID, accessSecret: ACCESS_SECRET });
    const uri = Common.DEFAULT_FDS_SERVICE_BASE_URI + 'my-bucket/my-object';
    const headers = { date: 'Sun, 06 Nov 1994 08:49:37 GMT' };
    expect(await plain.getAuthorizationHeader(HttpMethod.GET, uri, headers)).toBe(
      await newClient().getAuthorizationHeader(HttpMethod.GET, uri, headers),
    );
    expect(await plain.generatePresignedUri('b', 'o', FUTURE)).toBe(
      await newClient().generatePresignedUri('b', 'o', FUTURE),
    );
  });

  it('rejects a credential with neither credential shape', () => {
    expect(() => new GalaxyFDSSigner({} as never)).toThrow(GalaxyFDSSignerError);
    expect(() => new GalaxyFDSSigner({ accessId: ACCESS_ID } as never)).toThrow('credential');
  });

  it('accepts a plain string as the method in the options object', async () => {
    const client = newClient();
    expect(await client.generatePresignedUri('b', 'o', FUTURE, { method: 'PUT' })).toBe(
      await client.generatePresignedUri('b', 'o', FUTURE, { method: HttpMethod.PUT }),
    );
  });

  it('signs content-type and content-md5 into the pre-signed URI', async () => {
    const client = newClient();
    const plain = await client.generatePresignedUri('b', 'o', FUTURE, { method: 'PUT' });
    const withHeaders = await client.generatePresignedUri('b', 'o', FUTURE, {
      method: 'PUT',
      contentType: 'image/png',
      contentMD5: '1B2M2Y8AsgTpgAmY7PhCfg==',
    });
    expect(withHeaders).not.toBe(plain);
  });
});
