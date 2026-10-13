import { describe, expect, it } from 'vitest';

import {
  constructStringToSign,
  HeaderMultiMap,
  Signer,
  type SubResources,
} from '../src/auth/signer.js';
import { GalaxyFDSSignerError, HttpMethod, SignAlgorithm, SubResource } from '../src/index.js';

const ACCESS_ID = 'AKIDEXAMPLEACCESSID';
const ACCESS_SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY';

interface SignCase {
  name: string;
  httpMethod: HttpMethod;
  uri: string;
  headers: Array<[string, string]>;
  algorithm: SignAlgorithm;
  expected: {
    stringToSign: string;
    signature: string;
    /** `undefined` when the authorization header must be refused. */
    authorizationHeader: string | undefined;
  };
}

interface PresignCase {
  name: string;
  baseUri: string;
  bucketName: string;
  objectName: string;
  subResources: SubResources;
  expiresMillis: number;
  httpMethod: HttpMethod;
  headers?: Array<[string, string]>;
  algorithm: SignAlgorithm;
  expected: { uri: string };
}

// Representative cases pinned against galaxy-fds-sdk-java 3.0.48 output.
// Each one exercises a distinct facet of the signing rules; the expected
// values were captured from the reference Java SDK and are intentionally
// hard-coded so the suite has no external generation step.
const SIGN_CASES: SignCase[] = [
  {
    name: 'get-no-headers',
    httpMethod: HttpMethod.GET,
    uri: 'http://files.fds.api.xiaomi.com/my-bucket/my-object',
    headers: [],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      stringToSign: 'GET\n\n\n\n/my-bucket/my-object',
      signature: 'PJHrH088tbkMjrkSR6uO6n/wBck=',
      authorizationHeader: undefined,
    },
  },
  {
    name: 'get-with-date',
    httpMethod: HttpMethod.GET,
    uri: 'http://files.fds.api.xiaomi.com/my-bucket/my-object',
    headers: [['date', 'Sun, 06 Nov 1994 08:49:37 GMT']],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      stringToSign: 'GET\n\n\nSun, 06 Nov 1994 08:49:37 GMT\n/my-bucket/my-object',
      signature: 'TBmMdrY6ygseQ3mUk1KDg8Ala7A=',
      authorizationHeader: 'Galaxy-V2 AKIDEXAMPLEACCESSID:TBmMdrY6ygseQ3mUk1KDg8Ala7A=',
    },
  },
  {
    name: 'put-content-type-md5',
    httpMethod: HttpMethod.PUT,
    uri: 'http://files.fds.api.xiaomi.com/my-bucket/my-object',
    headers: [
      ['content-md5', '1B2M2Y8AsgTpgAmY7PhCfg=='],
      ['content-type', 'application/octet-stream'],
      ['date', 'Sun, 06 Nov 1994 08:49:37 GMT'],
    ],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      stringToSign:
        'PUT\n1B2M2Y8AsgTpgAmY7PhCfg==\napplication/octet-stream\nSun, 06 Nov 1994 08:49:37 GMT\n/my-bucket/my-object',
      signature: '3yZSU7TbLV4jERNvp12cCclLcqU=',
      authorizationHeader: 'Galaxy-V2 AKIDEXAMPLEACCESSID:3yZSU7TbLV4jERNvp12cCclLcqU=',
    },
  },
  {
    name: 'xiaomi-date-overrides-date',
    httpMethod: HttpMethod.GET,
    uri: 'http://files.fds.api.xiaomi.com/my-bucket/my-object',
    headers: [
      ['x-xiaomi-date', 'Sun, 06 Nov 1994 08:49:37 GMT'],
      ['date', 'Mon, 07 Nov 1994 08:49:37 GMT'],
    ],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      stringToSign: 'GET\n\n\n\nx-xiaomi-date:Sun, 06 Nov 1994 08:49:37 GMT\n/my-bucket/my-object',
      signature: 'LU3tbLo2KLE+p8/GXncFqLf5dSI=',
      authorizationHeader: 'Galaxy-V2 AKIDEXAMPLEACCESSID:LU3tbLo2KLE+p8/GXncFqLf5dSI=',
    },
  },
  {
    name: 'xiaomi-headers-sorted-merged',
    httpMethod: HttpMethod.PUT,
    uri: 'http://files.fds.api.xiaomi.com/my-bucket/my-object',
    headers: [
      ['x-xiaomi-meta-foo', 'bar'],
      ['x-xiaomi-acl', 'private'],
      ['x-xiaomi-meta-foo', 'baz'],
      ['date', 'Sun, 06 Nov 1994 08:49:37 GMT'],
    ],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      stringToSign:
        'PUT\n\n\nSun, 06 Nov 1994 08:49:37 GMT\nx-xiaomi-acl:private\nx-xiaomi-meta-foo:bar,baz\n/my-bucket/my-object',
      signature: 'RjqEVbwriDJxETn11JCPFXV+KDA=',
      authorizationHeader: 'Galaxy-V2 AKIDEXAMPLEACCESSID:RjqEVbwriDJxETn11JCPFXV+KDA=',
    },
  },
  {
    name: 'subresources-sorted',
    httpMethod: HttpMethod.GET,
    uri: 'http://files.fds.api.xiaomi.com/my-bucket/my-object?uploadId=abc123&partNumber=2&notsub=ignored&acl',
    headers: [['date', 'Sun, 06 Nov 1994 08:49:37 GMT']],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      stringToSign:
        'GET\n\n\nSun, 06 Nov 1994 08:49:37 GMT\n/my-bucket/my-object?acl&partNumber=2&uploadId=abc123',
      signature: 'bgwXw7MO6S3aQpn1CPRYMBbo2vM=',
      authorizationHeader: 'Galaxy-V2 AKIDEXAMPLEACCESSID:bgwXw7MO6S3aQpn1CPRYMBbo2vM=',
    },
  },
  {
    name: 'algorithm-sha256',
    httpMethod: HttpMethod.GET,
    uri: 'http://files.fds.api.xiaomi.com/my-bucket/my-object',
    headers: [['date', 'Sun, 06 Nov 1994 08:49:37 GMT']],
    algorithm: SignAlgorithm.HmacSHA256,
    expected: {
      stringToSign: 'GET\n\n\nSun, 06 Nov 1994 08:49:37 GMT\n/my-bucket/my-object',
      signature: 'aNIGdQuId3wH9Mqnz8RqtyQJonJZoWw5GP0npSshj1o=',
      authorizationHeader:
        'Galaxy-V2 AKIDEXAMPLEACCESSID:aNIGdQuId3wH9Mqnz8RqtyQJonJZoWw5GP0npSshj1o=',
    },
  },
  {
    name: 'algorithm-md5',
    httpMethod: HttpMethod.GET,
    uri: 'http://files.fds.api.xiaomi.com/my-bucket/my-object',
    headers: [['date', 'Sun, 06 Nov 1994 08:49:37 GMT']],
    algorithm: SignAlgorithm.HmacMD5,
    expected: {
      stringToSign: 'GET\n\n\nSun, 06 Nov 1994 08:49:37 GMT\n/my-bucket/my-object',
      signature: 'lq+J/JI++NPXUSG/4XPn1g==',
      authorizationHeader: 'Galaxy-V2 AKIDEXAMPLEACCESSID:lq+J/JI++NPXUSG/4XPn1g==',
    },
  },
  {
    // Java only recognizes lower-case names; the expected values are the Java
    // output for the lower-cased equivalent of these mixed-case headers.
    name: 'mixed-case-header-names',
    httpMethod: HttpMethod.PUT,
    uri: 'http://files.fds.api.xiaomi.com/my-bucket/my-object',
    headers: [
      ['Content-Type', 'text/plain'],
      ['Content-MD5', '1B2M2Y8AsgTpgAmY7PhCfg=='],
      ['Date', 'Sun, 06 Nov 1994 08:49:37 GMT'],
      ['X-Xiaomi-Meta-Foo', 'a'],
      ['x-xiaomi-meta-foo', 'b'],
    ],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      stringToSign:
        'PUT\n1B2M2Y8AsgTpgAmY7PhCfg==\ntext/plain\nSun, 06 Nov 1994 08:49:37 GMT\nx-xiaomi-meta-foo:a,b\n/my-bucket/my-object',
      signature: 'KXHN8Qb+7Bi76BkBx7/2YjKJEqw=',
      authorizationHeader: 'Galaxy-V2 AKIDEXAMPLEACCESSID:KXHN8Qb+7Bi76BkBx7/2YjKJEqw=',
    },
  },
  {
    name: 'encoded-query-is-decoded',
    httpMethod: HttpMethod.GET,
    uri: 'http://files.fds.api.xiaomi.com/b/o%20x?uploadId=a%2Fb%20c&partNumber=2',
    headers: [['date', 'Sun, 06 Nov 1994 08:49:37 GMT']],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      stringToSign: 'GET\n\n\nSun, 06 Nov 1994 08:49:37 GMT\n/b/o x?partNumber=2&uploadId=a/b c',
      signature: 'nL1l+Z4ZDwoiY4UYdcSgdHaYHz8=',
      authorizationHeader: 'Galaxy-V2 AKIDEXAMPLEACCESSID:nL1l+Z4ZDwoiY4UYdcSgdHaYHz8=',
    },
  },
  {
    name: 'encoded-utf8-and-plus-in-query',
    httpMethod: HttpMethod.GET,
    uri: 'http://files.fds.api.xiaomi.com/b/o?uploadId=%E4%B8%AD%2B+x&acl',
    headers: [['date', 'Sun, 06 Nov 1994 08:49:37 GMT']],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      stringToSign: 'GET\n\n\nSun, 06 Nov 1994 08:49:37 GMT\n/b/o?acl&uploadId=中++x',
      signature: 'GTVvf03EfyEFGKANmaHYiZUExYQ=',
      authorizationHeader: 'Galaxy-V2 AKIDEXAMPLEACCESSID:GTVvf03EfyEFGKANmaHYiZUExYQ=',
    },
  },
  {
    name: 'raw-non-ascii-path-and-query',
    httpMethod: HttpMethod.GET,
    uri: 'http://files.fds.api.xiaomi.com/b/%E4%B8%AD?uploadId=中',
    headers: [['date', 'Sun, 06 Nov 1994 08:49:37 GMT']],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      stringToSign: 'GET\n\n\nSun, 06 Nov 1994 08:49:37 GMT\n/b/中?uploadId=中',
      signature: '5tcqjibbOJlOl04+KWiwoZx+dK0=',
      authorizationHeader: 'Galaxy-V2 AKIDEXAMPLEACCESSID:5tcqjibbOJlOl04+KWiwoZx+dK0=',
    },
  },
  {
    name: 'invalid-utf8-becomes-replacement-char',
    httpMethod: HttpMethod.GET,
    uri: 'http://files.fds.api.xiaomi.com/b/o?uploadId=%FF',
    headers: [['date', 'Sun, 06 Nov 1994 08:49:37 GMT']],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      stringToSign: 'GET\n\n\nSun, 06 Nov 1994 08:49:37 GMT\n/b/o?uploadId=\uFFFD',
      signature: 'I5EJp3BKe+I/lxDKIPeeKAH1Wb4=',
      authorizationHeader: 'Galaxy-V2 AKIDEXAMPLEACCESSID:I5EJp3BKe+I/lxDKIPeeKAH1Wb4=',
    },
  },
  {
    name: 'dot-segments-are-not-normalized',
    httpMethod: HttpMethod.GET,
    uri: 'http://files.fds.api.xiaomi.com/b/a/../c?uploadId=x',
    headers: [['date', 'Sun, 06 Nov 1994 08:49:37 GMT']],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      stringToSign: 'GET\n\n\nSun, 06 Nov 1994 08:49:37 GMT\n/b/a/../c?uploadId=x',
      signature: 'b8I6NRW1fOgnvQD3FVUuA0Q6+5w=',
      authorizationHeader: 'Galaxy-V2 AKIDEXAMPLEACCESSID:b8I6NRW1fOgnvQD3FVUuA0Q6+5w=',
    },
  },
  {
    name: 'encoded-slash-in-path-and-fragment',
    httpMethod: HttpMethod.GET,
    uri: 'http://files.fds.api.xiaomi.com/b/o%2Fp?partNumber=1#frag',
    headers: [['date', 'Sun, 06 Nov 1994 08:49:37 GMT']],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      stringToSign: 'GET\n\n\nSun, 06 Nov 1994 08:49:37 GMT\n/b/o/p?partNumber=1',
      signature: 'AUkI0PdlEfSpF+wslBtjyF8i5x8=',
      authorizationHeader: 'Galaxy-V2 AKIDEXAMPLEACCESSID:AUkI0PdlEfSpF+wslBtjyF8i5x8=',
    },
  },
  {
    name: 'expires-in-uri',
    httpMethod: HttpMethod.GET,
    uri: 'http://files.fds.api.xiaomi.com/my-bucket/my-object?GalaxyAccessKeyId=AKIDEXAMPLEACCESSID&Expires=1700000000000',
    headers: [],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      stringToSign: 'GET\n\n\n1700000000000\n/my-bucket/my-object',
      signature: 'p+qjVTQ54pVld7OUrbO3ge5VinM=',
      authorizationHeader: 'Galaxy-V2 AKIDEXAMPLEACCESSID:p+qjVTQ54pVld7OUrbO3ge5VinM=',
    },
  },
];

const PRESIGN_CASES: PresignCase[] = [
  {
    name: 'presign-get-basic',
    baseUri: 'http://files.fds.api.xiaomi.com/',
    bucketName: 'my-bucket',
    objectName: 'my-object',
    subResources: [],
    expiresMillis: 1700000000000,
    httpMethod: HttpMethod.GET,
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      uri: 'http://files.fds.api.xiaomi.com/my-bucket/my-object?GalaxyAccessKeyId=AKIDEXAMPLEACCESSID&Expires=1700000000000&Signature=p%2BqjVTQ54pVld7OUrbO3ge5VinM%3D',
    },
  },
  {
    name: 'presign-get-empty-object',
    baseUri: 'http://files.fds.api.xiaomi.com/',
    bucketName: 'my-bucket',
    objectName: '',
    subResources: [],
    expiresMillis: 1700000000000,
    httpMethod: HttpMethod.GET,
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      uri: 'http://files.fds.api.xiaomi.com/my-bucket?GalaxyAccessKeyId=AKIDEXAMPLEACCESSID&Expires=1700000000000&Signature=QNE9PNhIxuCnhT9obtZwc2eXOKE%3D',
    },
  },
  {
    name: 'presign-with-subresources-multi',
    baseUri: 'http://files.fds.api.xiaomi.com/',
    bucketName: 'my-bucket',
    objectName: 'my-object',
    subResources: [SubResource.METADATA, SubResource.ACL],
    expiresMillis: 1700000000000,
    httpMethod: HttpMethod.GET,
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      uri: 'http://files.fds.api.xiaomi.com/my-bucket/my-object?metadata&acl&GalaxyAccessKeyId=AKIDEXAMPLEACCESSID&Expires=1700000000000&Signature=boZSYK3WfKmpn71iqMWUiygl%2Bro%3D',
    },
  },
  {
    // Java 3.0.48 renders the value as `a/b%20c`; both forms decode to the
    // same signed query `uploadId=a/b c`, so the signature is identical.
    name: 'presign-with-subresource-values',
    baseUri: 'http://files.fds.api.xiaomi.com/',
    bucketName: 'my-bucket',
    objectName: 'my-object',
    subResources: { uploadId: 'a/b c', partNumber: 2 },
    expiresMillis: 1700000000000,
    httpMethod: HttpMethod.PUT,
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      uri: 'http://files.fds.api.xiaomi.com/my-bucket/my-object?uploadId=a%2Fb%20c&partNumber=2&GalaxyAccessKeyId=AKIDEXAMPLEACCESSID&Expires=1700000000000&Signature=vA4GmeJJDpHV4BoFNqLxE6Y472U%3D',
    },
  },
  {
    name: 'presign-with-content-type-md5',
    baseUri: 'http://files.fds.api.xiaomi.com/',
    bucketName: 'my-bucket',
    objectName: 'my-object',
    subResources: [],
    expiresMillis: 1700000000000,
    httpMethod: HttpMethod.PUT,
    headers: [
      ['content-type', 'image/png'],
      ['content-md5', '1B2M2Y8AsgTpgAmY7PhCfg=='],
    ],
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      uri: 'http://files.fds.api.xiaomi.com/my-bucket/my-object?GalaxyAccessKeyId=AKIDEXAMPLEACCESSID&Expires=1700000000000&Signature=maqy85AnDZNB%2BpL35UZPmGEcPl0%3D',
    },
  },
  {
    name: 'presign-object-with-spaces',
    baseUri: 'http://files.fds.api.xiaomi.com/',
    bucketName: 'my-bucket',
    objectName: 'path with spaces/a+b.txt',
    subResources: [],
    expiresMillis: 1700000000000,
    httpMethod: HttpMethod.GET,
    algorithm: SignAlgorithm.HmacSHA1,
    expected: {
      uri: 'http://files.fds.api.xiaomi.com/my-bucket/path%20with%20spaces/a+b.txt?GalaxyAccessKeyId=AKIDEXAMPLEACCESSID&Expires=1700000000000&Signature=SslO4rj2jd%2BpAGasj24LHRf3qTQ%3D',
    },
  },
];

function toHeaders(entries?: Array<[string, string]>): HeaderMultiMap | undefined {
  if (entries === undefined) {
    return undefined;
  }
  const map = new HeaderMultiMap();
  for (const [k, v] of entries) {
    map.put(k, v);
  }
  return map;
}

describe('signing — golden parity with galaxy-fds-sdk-java', () => {
  for (const c of SIGN_CASES) {
    describe(c.name, () => {
      const headers = toHeaders(c.headers);

      it('constructs the same string to sign', () => {
        const actual = constructStringToSign(c.httpMethod, c.uri, HeaderMultiMap.from(headers));
        expect(actual).toBe(c.expected.stringToSign);
      });

      it('produces the same signature', async () => {
        const actual = await Signer.signToBase64(
          c.httpMethod,
          c.uri,
          headers,
          ACCESS_SECRET,
          c.algorithm,
        );
        expect(actual).toBe(c.expected.signature);
      });

      it('produces the same authorization header', async () => {
        const build = () =>
          Signer.getAuthorizationHeader(
            c.httpMethod,
            c.uri,
            headers,
            ACCESS_ID,
            ACCESS_SECRET,
            c.algorithm,
          );
        if (c.expected.authorizationHeader === undefined) {
          // No date and no Expires: the server would reject it, so we refuse.
          await expect(build()).rejects.toThrow(GalaxyFDSSignerError);
        } else {
          expect(await build()).toBe(c.expected.authorizationHeader);
        }
      });
    });
  }
});

describe('pre-signed URI — golden parity with galaxy-fds-sdk-java', () => {
  for (const c of PRESIGN_CASES) {
    it(c.name, async () => {
      const actual = await Signer.generatePresignedUri({
        baseUri: c.baseUri,
        bucketName: c.bucketName,
        objectName: c.objectName,
        subResources: c.subResources,
        expiration: c.expiresMillis,
        method: c.httpMethod,
        accessId: ACCESS_ID,
        accessSecret: ACCESS_SECRET,
        algorithm: c.algorithm,
        headers: toHeaders(c.headers),
      });
      expect(actual).toBe(c.expected.uri);
    });
  }
});
