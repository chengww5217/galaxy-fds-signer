import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  constructStringToSign,
  HeaderMultiMap,
  HttpMethod,
  SignAlgorithm,
  Signer,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

interface SignCase {
  name: string;
  httpMethod: string;
  uri: string;
  headers: Array<[string, string]>;
  algorithm: string;
  accessId: string;
  accessSecret: string;
  expected: {
    stringToSign: string;
    signature: string;
    authorizationHeader: string;
  };
}

interface PresignCase {
  name: string;
  baseUri: string;
  bucketName: string;
  objectName: string;
  subResources: string[] | null;
  expiresMillis: number;
  httpMethod: string;
  headers: Array<[string, string]> | null;
  algorithm: string;
  accessId: string;
  accessSecret: string;
  expected: { uri: string };
}

const golden = JSON.parse(
  readFileSync(resolve(here, 'fixtures/golden.json'), 'utf-8'),
) as { signCases: SignCase[]; presignCases: PresignCase[] };

function toHeaders(entries: Array<[string, string]> | null): HeaderMultiMap | undefined {
  if (entries == null) {
    return undefined;
  }
  const map = new HeaderMultiMap();
  for (const [k, v] of entries) {
    map.put(k, v);
  }
  return map;
}

describe('signing — golden parity with galaxy-fds-sdk-java 3.0.48', () => {
  it('has a non-empty fixture set', () => {
    expect(golden.signCases.length).toBeGreaterThan(0);
    expect(golden.presignCases.length).toBeGreaterThan(0);
  });

  for (const c of golden.signCases) {
    describe(c.name, () => {
      const method = c.httpMethod as HttpMethod;
      const alg = c.algorithm as SignAlgorithm;
      const headers = toHeaders(c.headers);

      it('constructs the same string to sign', () => {
        const actual = constructStringToSign(method, c.uri, HeaderMultiMap.from(headers));
        expect(actual).toBe(c.expected.stringToSign);
      });

      it('produces the same signature', () => {
        const actual = Signer.signToBase64(method, c.uri, headers, c.accessSecret, alg);
        expect(actual).toBe(c.expected.signature);
      });

      it('produces the same authorization header', () => {
        const actual = Signer.getAuthorizationHeader(
          method,
          c.uri,
          headers,
          c.accessId,
          c.accessSecret,
          alg,
        );
        expect(actual).toBe(c.expected.authorizationHeader);
      });
    });
  }
});

describe('pre-signed URI — golden parity with galaxy-fds-sdk-java 3.0.48', () => {
  for (const c of golden.presignCases) {
    it(c.name, () => {
      const actual = Signer.generatePresignedUri(
        c.baseUri,
        c.bucketName,
        c.objectName,
        c.subResources,
        c.expiresMillis,
        c.httpMethod as HttpMethod,
        c.accessId,
        c.accessSecret,
        c.algorithm as SignAlgorithm,
        toHeaders(c.headers),
      );
      expect(actual).toBe(c.expected.uri);
    });
  }
});
