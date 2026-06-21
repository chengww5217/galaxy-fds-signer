import { describe, expect, it } from 'vitest';

import {
  calcMD5,
  getGMTDatetime,
  parseUri,
  parseUriParameters,
  urlEncode,
} from '../src/index.js';

// Expected values captured from galaxy-fds-sdk-java 3.0.48.
const MD5_CASES: Array<{ input: string; expected: string }> = [
  { input: '', expected: 'd41d8cd98f00b204e9800998ecf8427e' },
  { input: 'hello', expected: '5d41402abc4b2a76b9719d911017c592' },
  {
    input: 'The quick brown fox jumps over the lazy dog',
    expected: '9e107d9d372bb6826bd81d3542a419d6',
  },
  { input: '中文字符串', expected: '353c198568f0cd08eb215d21f45938a3' },
  { input: 'a/b/c?x=1&y=2', expected: '643f6fdd7fec4c992c55040ed4d681c7' },
];

const URL_ENCODE_CASES: Array<{ input: string; expected: string }> = [
  { input: '', expected: '' },
  { input: 'simple', expected: 'simple' },
  { input: 'a+b/c*d~e', expected: 'a%2Bb%2Fc%2Ad%7Ee' },
  { input: 'path with spaces', expected: 'path%20with%20spaces' },
  { input: 'p+qjVTQ54pVld7OUrbO3ge5VinM=', expected: 'p%2BqjVTQ54pVld7OUrbO3ge5VinM%3D' },
  { input: '中文', expected: '%E4%B8%AD%E6%96%87' },
  { input: 'a.b-c_d', expected: 'a.b-c_d' },
];

describe('calcMD5 — golden parity', () => {
  for (const c of MD5_CASES) {
    it(`md5(${JSON.stringify(c.input)})`, () => {
      expect(calcMD5(c.input)).toBe(c.expected);
    });
  }
});

describe('urlEncode — golden parity', () => {
  for (const c of URL_ENCODE_CASES) {
    it(`urlEncode(${JSON.stringify(c.input)})`, () => {
      expect(urlEncode(c.input)).toBe(c.expected);
    });
  }

  it('returns empty string for null/undefined', () => {
    expect(urlEncode(null)).toBe('');
    expect(urlEncode(undefined)).toBe('');
  });
});

describe('parseUriParameters', () => {
  it('returns an empty list for null or empty query', () => {
    expect(parseUriParameters(null)).toEqual([]);
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

  it('reports port -1 and null query when absent', () => {
    const parts = parseUri('http://host/bucket/obj');
    expect(parts.port).toBe(-1);
    expect(parts.query).toBeNull();
  });

  it('decodes the path component', () => {
    const parts = parseUri('http://host/bucket/a%20b');
    expect(parts.path).toBe('/bucket/a b');
  });
});

describe('getGMTDatetime', () => {
  it('formats a date as an RFC 822 GMT string', () => {
    const d = new Date(Date.UTC(1994, 10, 6, 8, 49, 37));
    expect(getGMTDatetime(d)).toBe('Sun, 06 Nov 1994 08:49:37 GMT');
  });
});
