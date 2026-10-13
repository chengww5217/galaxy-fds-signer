import { describe, expect, it } from 'vitest';

import * as api from '../src/index.js';

describe('public exports', () => {
  it('exposes only the supported runtime API', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'GalaxyFDSSignerError',
        'HttpMethod',
        'SignAlgorithm',
        'SubResource',
        'XiaomiHeader',
        'createSigner',
        'presign',
        'signRequest',
      ].sort(),
    );
  });
});
