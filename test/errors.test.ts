import { describe, expect, it } from 'vitest';

import { GalaxyFDSSigner, GalaxyFDSSignerError, Signer } from '../src/index.js';

describe('GalaxyFDSSignerError', () => {
  it('carries message, name and cause', () => {
    const cause = new Error('boom');
    const err = new GalaxyFDSSignerError('failed', { cause });
    expect(err.message).toBe('failed');
    expect(err.name).toBe('GalaxyFDSSignerError');
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(GalaxyFDSSignerError);
    expect(err).toBeInstanceOf(Error);
  });

  it('works without any options', () => {
    const err = new GalaxyFDSSignerError();
    expect(err.cause).toBeUndefined();
  });
});

describe('error normalization', () => {
  const URI = 'http://files.fds.api.xiaomi.com/b/o';
  const DATE = { date: 'Sun, 06 Nov 1994 08:49:37 GMT' };

  it.each([
    ['an invalid URI', () => Signer.signToBase64('GET', 'not a uri', DATE, 'secret')],
    ['a relative URI', () => Signer.signToBase64('GET', '/b/o', DATE, 'secret')],
    ['an empty secret', () => Signer.signToBase64('GET', URI, DATE, '')],
    ['a non-string secret', () => Signer.signToBase64('GET', URI, DATE, 42 as never)],
    ['an empty access id', () => Signer.getAuthorizationHeader('GET', URI, DATE, '', 'secret')],
    ['invalid headers', () => Signer.getAuthorizationHeader('GET', URI, 42 as never, 'id', 's')],
    [
      'an invalid base URI',
      () =>
        Signer.generatePresignedUri({
          baseUri: 'nope',
          bucketName: 'b',
          expiration: 4102444800000,
          accessId: 'id',
          accessSecret: 's',
        }),
    ],
    [
      'an invalid baseUri option',
      () => new GalaxyFDSSigner({ accessId: 'id', accessSecret: 's' }, { baseUri: 'nope' }),
    ],
  ])('throws GalaxyFDSSignerError for %s', (_name, fn) => {
    expect(fn).toThrow(GalaxyFDSSignerError);
  });

  it('does not re-wrap its own errors', () => {
    try {
      Signer.generatePresignedUri({
        baseUri: 'http://h/',
        bucketName: 'b',
        expiration: 1,
        accessId: 'id',
        accessSecret: 's',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/^expiration/);
      expect((e as Error).cause).toBeUndefined();
    }
  });
});
