import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { createSigner } from '../src/index.js';

const SECRET = 'super-secret-value-do-not-log';

describe('secret confidentiality', () => {
  const signer = createSigner({ accessId: 'my-id', accessSecret: SECRET });

  it('does not expose the secret on the signer', () => {
    expect(inspect(signer, { depth: Infinity, showHidden: true })).not.toContain(SECRET);
    expect(JSON.stringify(signer)).not.toContain(SECRET);
    expect(String(signer)).not.toContain(SECRET);
  });

  it('does not include the secret in signed or pre-signed requests', async () => {
    const signed = await signer.signRequest({ bucket: 'b', object: 'o' });
    const presigned = await signer.presign({ bucket: 'b', object: 'o' });
    expect(JSON.stringify([signed, presigned])).not.toContain(SECRET);
  });

  it('does not include the secret in error messages', async () => {
    const error = await signer.signRequest({ method: 'PATCH' as never }).catch((e: Error) => e);
    expect(inspect(error)).not.toContain(SECRET);
  });
});
