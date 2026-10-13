import { describe, expect, it } from 'vitest';

import * as api from '../src/index.js';

describe('public exports', () => {
  it('exposes only the supported runtime API', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'BasicFDSCredential',
        'FDSEndpointConfiguration',
        'GalaxyFDSSigner',
        'GalaxyFDSSignerError',
        'HttpMethod',
        'SignAlgorithm',
        'Signer',
        'SubResource',
        'XiaomiHeader',
        'constructStringToSign',
        'urlEncode',
      ].sort(),
    );
  });
});
