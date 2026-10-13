import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { BasicFDSCredential, GalaxyFDSSigner } from '../src/index.js';

const SECRET = 'super-secret-value-do-not-log';

describe('secret confidentiality', () => {
  const credential = new BasicFDSCredential('my-id', SECRET);
  const signers = [
    new GalaxyFDSSigner(credential),
    new GalaxyFDSSigner({ accessId: 'my-id', accessSecret: SECRET }),
  ];

  const cases: Array<[string, unknown]> = [
    ['credential', credential],
    ...signers.map((s, i): [string, unknown] => [`signer #${i}`, s]),
  ];

  it.each(cases)('does not expose the secret of a %s', (_name, value) => {
    expect(inspect(value, { depth: Infinity, showHidden: true })).not.toContain(SECRET);
    expect(JSON.stringify(value)).not.toContain(SECRET);
    expect(String(value)).not.toContain(SECRET);
  });

  it('still serializes the access id of a credential', () => {
    expect(JSON.parse(JSON.stringify(credential))).toEqual({ accessId: 'my-id' });
  });
});
