import { describe, expect, it } from 'vitest';

import { GalaxyFDSClientException } from '../src/index.js';

describe('GalaxyFDSClientException', () => {
  it('carries message, name, statusCode and cause', () => {
    const cause = new Error('boom');
    const err = new GalaxyFDSClientException('failed', { cause, statusCode: 403 });
    expect(err.message).toBe('failed');
    expect(err.name).toBe('GalaxyFDSClientException');
    expect(err.statusCode).toBe(403);
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(GalaxyFDSClientException);
    expect(err).toBeInstanceOf(Error);
  });

  it('works without any options', () => {
    const err = new GalaxyFDSClientException();
    expect(err.statusCode).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });
});
