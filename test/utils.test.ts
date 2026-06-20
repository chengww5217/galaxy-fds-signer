import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  calcMD5,
  getGMTDatetime,
  parseUri,
  parseUriParameters,
  urlEncode,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(resolve(here, 'fixtures/golden.json'), 'utf-8')) as {
  md5Cases: Array<{ input: string; expected: string }>;
  urlEncodeCases: Array<{ input: string; expected: string }>;
};

describe('calcMD5 — golden parity', () => {
  for (const c of golden.md5Cases) {
    it(`md5(${JSON.stringify(c.input)})`, () => {
      expect(calcMD5(c.input)).toBe(c.expected);
    });
  }
});

describe('urlEncode — golden parity', () => {
  for (const c of golden.urlEncodeCases) {
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
