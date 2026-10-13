import { GalaxyFDSSignerError } from './errors.js';

/**
 * Galaxy FDS access credential.
 *
 * Ported from `com.xiaomi.infra.galaxy.fds.client.credential.GalaxyFDSCredential`.
 * Kerberos-related members are intentionally omitted because this library only
 * implements signature-based authentication.
 */
export interface GalaxyFDSCredential {
  /** The user's access key id. */
  getGalaxyAccessId(): string;

  /** The user's secret access key, used as the HMAC key when signing. */
  getGalaxyAccessSecret(): string;
}

/**
 * A plain-object credential: just the access id / secret pair, no getters.
 * Accepted anywhere a {@link CredentialInput} is expected.
 */
export interface CredentialObject {
  /** The access key id. */
  accessId: string;
  /** The secret access key, used as the HMAC key when signing. */
  accessSecret: string;
}

/** Any credential shape accepted by {@link GalaxyFDSSigner}. */
export type CredentialInput = GalaxyFDSCredential | CredentialObject;

/**
 * Basic implementation of {@link GalaxyFDSCredential} backed by a static
 * access id / secret pair.
 *
 * Ported from `com.xiaomi.infra.galaxy.fds.client.credential.BasicFDSCredential`.
 */
export class BasicFDSCredential implements GalaxyFDSCredential {
  // ECMAScript private fields: unlike TypeScript `private`, they are not
  // visible to console.log / util.inspect / JSON.stringify / Object.keys,
  // so the secret cannot leak into logs by accident.
  readonly #accessId: string;
  readonly #accessSecret: string;

  constructor(accessId: string, accessSecret: string) {
    this.#accessId = accessId;
    this.#accessSecret = accessSecret;
  }

  getGalaxyAccessId(): string {
    return this.#accessId;
  }

  getGalaxyAccessSecret(): string {
    return this.#accessSecret;
  }

  /** Serializes without the secret. */
  toJSON(): { accessId: string } {
    return { accessId: this.#accessId };
  }
}

/**
 * Normalizes a {@link CredentialInput} into a {@link GalaxyFDSCredential},
 * accepting either the getter-based interface or a plain
 * `{ accessId, accessSecret }` object.
 *
 * @throws GalaxyFDSSignerError when the input has neither shape.
 */
export function toGalaxyFDSCredential(input: CredentialInput): GalaxyFDSCredential {
  const credential = input as GalaxyFDSCredential;
  if (
    typeof credential.getGalaxyAccessId === 'function' &&
    typeof credential.getGalaxyAccessSecret === 'function'
  ) {
    return credential;
  }
  const { accessId, accessSecret } = input as CredentialObject;
  if (typeof accessId !== 'string' || typeof accessSecret !== 'string') {
    throw new GalaxyFDSSignerError(
      'credential must implement GalaxyFDSCredential or be { accessId, accessSecret }',
    );
  }
  return new BasicFDSCredential(accessId, accessSecret);
}
