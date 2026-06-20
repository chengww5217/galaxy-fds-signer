/**
 * Galaxy FDS access credential.
 *
 * Ported from `com.xiaomi.infra.galaxy.fds.client.credential.GalaxyFDSCredential`.
 * Kerberos-related members are intentionally omitted because this SDK only
 * implements signature-based authentication.
 */
export interface GalaxyFDSCredential {
  /** The user's access key id. */
  getGalaxyAccessId(): string;

  /** The user's secret access key, used as the HMAC key when signing. */
  getGalaxyAccessSecret(): string;
}

/**
 * Basic implementation of {@link GalaxyFDSCredential} backed by a static
 * access id / secret pair.
 *
 * Ported from `com.xiaomi.infra.galaxy.fds.client.credential.BasicFDSCredential`.
 */
export class BasicFDSCredential implements GalaxyFDSCredential {
  private readonly accessId: string;
  private readonly accessSecret: string;

  constructor(accessId: string, accessSecret: string) {
    this.accessId = accessId;
    this.accessSecret = accessSecret;
  }

  getGalaxyAccessId(): string {
    return this.accessId;
  }

  getGalaxyAccessSecret(): string {
    return this.accessSecret;
  }
}
