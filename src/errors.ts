/**
 * Where an error comes from, so callers can decide what to expose:
 *
 * - `config`: the signer is misconfigured (credentials, endpoint, algorithm).
 *   A server-side problem; messages may mention internal hosts.
 * - `input`: the request to sign is invalid (bucket, headers, expiration, ...).
 *   Usually caused by the end user's request.
 * - `runtime`: the environment failed (no Web Crypto, unexpected error).
 */
export type GalaxyFDSSignerErrorKind = 'config' | 'input' | 'runtime';

const CODE_KINDS = {
  INVALID_OPTIONS: 'config',
  INVALID_CREDENTIALS: 'config',
  UNSUPPORTED_ALGORITHM: 'config',
  INVALID_ENDPOINT: 'config',
  INVALID_BUCKET_OPTION: 'config',
  CDN_NOT_CONFIGURED: 'config',
  UNSUPPORTED_METHOD: 'input',
  INVALID_HEADERS: 'input',
  MISSING_DATE: 'input',
  INVALID_BUCKET: 'input',
  INVALID_OBJECT: 'input',
  INVALID_SUB_RESOURCE: 'input',
  INVALID_URL: 'input',
  INVALID_DATE: 'input',
  INVALID_EXPIRATION: 'input',
  CRYPTO_UNAVAILABLE: 'runtime',
  SIGNING_FAILED: 'runtime',
} as const satisfies Record<string, GalaxyFDSSignerErrorKind>;

/** Stable, machine-readable error code; see {@link ErrorCode}. */
export type GalaxyFDSSignerErrorCode = keyof typeof CODE_KINDS;

/**
 * Every {@link GalaxyFDSSignerErrorCode}, e.g. `ErrorCode.INVALID_BUCKET`
 * (whose value is the string `'INVALID_BUCKET'`).
 */
export const ErrorCode = Object.freeze(
  Object.fromEntries(Object.keys(CODE_KINDS).map((code) => [code, code])),
) as { readonly [C in GalaxyFDSSignerErrorCode]: C };

/** The {@link GalaxyFDSSignerErrorKind} of `code`. */
export function errorKind(code: GalaxyFDSSignerErrorCode): GalaxyFDSSignerErrorKind {
  return CODE_KINDS[code];
}

/** JSON form of a {@link GalaxyFDSSignerError}; never includes `cause`. */
export interface GalaxyFDSSignerErrorJSON {
  name: 'GalaxyFDSSignerError';
  code: GalaxyFDSSignerErrorCode;
  kind: GalaxyFDSSignerErrorKind;
  field?: string;
  message: string;
}

/**
 * Error thrown by the Galaxy FDS signer. `code` and `kind` are stable API;
 * `message` is for humans and may change. The library performs no network
 * I/O, so no HTTP status is attached; the underlying error, if any, is
 * available as {@link Error.cause}.
 */
export class GalaxyFDSSignerError extends Error {
  /** Machine-readable error code. */
  readonly code: GalaxyFDSSignerErrorCode;
  /** Category of {@link code}. */
  readonly kind: GalaxyFDSSignerErrorKind;
  /** The option or input field at fault, e.g. `'bucket'` or `'expiresIn'`. */
  readonly field?: string;

  /**
   * Errors are created by the library only; the signature is kept in the
   * published declarations so the type stays honest (an omitted constructor
   * would silently fall back to `Error`'s optional-argument one).
   */
  constructor(
    code: GalaxyFDSSignerErrorCode,
    message: string,
    options?: { cause?: unknown; field?: string },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'GalaxyFDSSignerError';
    this.code = code;
    this.kind = errorKind(code);
    if (options?.field !== undefined) {
      this.field = options.field;
    }
  }

  /** `{ name, code, kind, field, message }`, without `cause` or the stack. */
  toJSON(): GalaxyFDSSignerErrorJSON {
    const json: GalaxyFDSSignerErrorJSON = {
      name: 'GalaxyFDSSignerError',
      code: this.code,
      kind: this.kind,
      message: this.message,
    };
    if (this.field !== undefined) {
      json.field = this.field;
    }
    return json;
  }
}

/**
 * Runs `fn`, re-throwing any non-{@link GalaxyFDSSignerError} as a
 * {@link GalaxyFDSSignerError} with `code` and the original error as its
 * cause. The library's own errors pass through unchanged.
 */
export function wrapErrors<T>(
  code: GalaxyFDSSignerErrorCode,
  message: string,
  fn: () => T,
  field?: string,
): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof GalaxyFDSSignerError) {
      throw e;
    }
    throw new GalaxyFDSSignerError(
      code,
      `${message}: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e, field },
    );
  }
}

/** Async variant of {@link wrapErrors}; synchronous throws are wrapped too. */
export async function wrapErrorsAsync<T>(
  code: GalaxyFDSSignerErrorCode,
  message: string,
  fn: () => Promise<T>,
  field?: string,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    return wrapErrors(
      code,
      message,
      () => {
        throw e;
      },
      field,
    );
  }
}

/** Throws a `code` error for `name` unless `value` is a non-empty string. */
export function requireString(
  value: unknown,
  name: string,
  code: GalaxyFDSSignerErrorCode,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new GalaxyFDSSignerError(code, `${name} must be a non-empty string`, { field: name });
  }
  return value;
}
