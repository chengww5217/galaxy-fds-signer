/**
 * Error thrown by the Galaxy FDS SDK.
 *
 * Ported from `com.xiaomi.infra.galaxy.fds.client.exception.GalaxyFDSClientException`.
 * The optional {@link statusCode} carries an HTTP status when available.
 */
export class GalaxyFDSClientException extends Error {
  /** HTTP status code associated with the error, or `undefined` if not applicable. */
  readonly statusCode?: number;

  constructor(message?: string, options?: { cause?: unknown; statusCode?: number }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'GalaxyFDSClientException';
    this.statusCode = options?.statusCode;
    // Restore prototype chain for instanceof checks when compiled to older targets.
    Object.setPrototypeOf(this, GalaxyFDSClientException.prototype);
  }
}
