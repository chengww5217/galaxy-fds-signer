import { describe, expect, it } from 'vitest';

import { urlEncode } from '../src/index.js';
import { encodeUriPath, parseUri, parseUriParameters } from '../src/auth/utils.js';

// Expected values captured from galaxy-fds-sdk-java 3.0.48.
const URL_ENCODE_CASES: Array<{ input: string; expected: string }> = [
  { input: '', expected: '' },
  { input: 'simple', expected: 'simple' },
  { input: 'a+b/c*d~e', expected: 'a%2Bb%2Fc%2Ad%7Ee' },
  { input: 'path with spaces', expected: 'path%20with%20spaces' },
  { input: 'p+qjVTQ54pVld7OUrbO3ge5VinM=', expected: 'p%2BqjVTQ54pVld7OUrbO3ge5VinM%3D' },
  { input: '中文', expected: '%E4%B8%AD%E6%96%87' },
  { input: 'a.b-c_d', expected: 'a.b-c_d' },
];

describe('urlEncode — golden parity', () => {
  for (const c of URL_ENCODE_CASES) {
    it(`urlEncode(${JSON.stringify(c.input)})`, () => {
      expect(urlEncode(c.input)).toBe(c.expected);
    });
  }

  it('returns empty string for undefined', () => {
    expect(urlEncode(undefined)).toBe('');
    expect(urlEncode()).toBe('');
  });
});

describe('parseUriParameters', () => {
  it('returns an empty list for undefined or empty query', () => {
    expect(parseUriParameters(undefined)).toEqual([]);
    expect(parseUriParameters('')).toEqual([]);
  });

  it('keeps everything after the first "=" as the value', () => {
    expect(parseUriParameters('a=1=2&b=3')).toEqual([
      ['a', '1=2'],
      ['b', '3'],
    ]);
  });

  it('treats a key without "=" as an empty value', () => {
    expect(parseUriParameters('acl&partNumber=2')).toEqual([
      ['acl', ''],
      ['partNumber', '2'],
    ]);
  });
});

describe('parseUri', () => {
  it('splits scheme, host, port, path and query', () => {
    const parts = parseUri('http://files.fds.api.xiaomi.com:8080/bucket/obj?acl&x=1');
    expect(parts.scheme).toBe('http');
    expect(parts.host).toBe('files.fds.api.xiaomi.com');
    expect(parts.port).toBe(8080);
    expect(parts.path).toBe('/bucket/obj');
    expect(parts.query).toBe('acl&x=1');
  });

  it('reports port -1 and undefined query when absent', () => {
    const parts = parseUri('http://host/bucket/obj');
    expect(parts.port).toBe(-1);
    expect(parts.query).toBeUndefined();
  });

  it('decodes the path component', () => {
    const parts = parseUri('http://host/bucket/a%20b');
    expect(parts.path).toBe('/bucket/a b');
  });

  it('decodes the query component like java.net.URI.getQuery', () => {
    expect(parseUri('http://host/b/o?uploadId=a%2Fb%20c+d').query).toBe('uploadId=a/b c+d');
  });

  it('does not throw on malformed percent sequences', () => {
    expect(parseUri('http://host/b/100%?x=%zz').path).toBe('/b/100%');
  });
});

describe('encodeUriPath', () => {
  it('encodes spaces as %20 and leaves + intact', () => {
    expect(encodeUriPath('/b/path with spaces/a+b.txt')).toBe('/b/path%20with%20spaces/a+b.txt');
  });

  it('percent-encodes non-ASCII characters as UTF-8', () => {
    expect(encodeUriPath('/b/中文')).toBe('/b/%E4%B8%AD%E6%96%87');
  });

  it('keeps RFC 2396 path characters untouched', () => {
    expect(encodeUriPath("/b/a-_.!~*'():@&=+$,;/c")).toBe("/b/a-_.!~*'():@&=+$,;/c");
  });

  it('encodes characters outside the path set', () => {
    expect(encodeUriPath('/b/a?b#c"d')).toBe('/b/a%3Fb%23c%22d');
  });
});
