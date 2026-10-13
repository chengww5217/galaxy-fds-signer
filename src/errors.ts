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

/**
 * Runs `fn`, re-throwing any non-{@link GalaxyFDSSignerError} as a
 * {@link GalaxyFDSSignerError} with the original error as its cause.
 */
export function wrapErrors<T>(message: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof GalaxyFDSSignerError) {
      throw e;
    }
    throw new GalaxyFDSSignerError(`${message}: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    });
  }
}

/** Throws unless `value` is a non-empty string. */
export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new GalaxyFDSSignerError(`${name} must be a non-empty string`);
  }
  return value;
}
