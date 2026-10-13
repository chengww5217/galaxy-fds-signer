/**
 * Error thrown by the Galaxy FDS signer for invalid input (bad URI,
 * credential, expiration, method, ...). The library performs no network I/O,
 * so there is no HTTP status attached; the underlying error, if any, is
 * available as {@link Error.cause}.
 */
export class GalaxyFDSSignerError extends Error {
  constructor(message?: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'GalaxyFDSSignerError';
  }
}
