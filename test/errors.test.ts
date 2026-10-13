import { describe, expect, it } from 'vitest';

import { GalaxyFDSSignerError } from '../src/index.js';

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
