import { FDSEndpointConfiguration, type FDSEndpointOptions } from './config.js';
import { Common } from './common.js';
import {
  HttpMethod,
  SignAlgorithm,
  SUB_RESOURCE_SET,
  toHttpMethod,
  toSignAlgorithm,
  XiaomiHeader,
} from './enums.js';
import {
  GalaxyFDSSignerError,
  type GalaxyFDSSignerErrorCode,
  requireString,
  wrapErrors,
} from './errors.js';
import {
  formatSubResources,
  HeaderMultiMap,
  type HttpHeaders,
  Signer,
  type SubResources,
  toExpiresMillis,
} from './auth/signer.js';
import { encodeUriPath, urlEncode } from './auth/utils.js';

/** Configuration shared by every request signed with {@link createSigner}. */
export interface SignerOptions extends FDSEndpointOptions {
  /** The access key id. */
  accessId: string;
  /** The secret access key. Kept in a closure; never exposed on the signer. */
  accessSecret: string;
  /** Signature algorithm; defaults to {@link SignAlgorithm.HmacSHA1}. */
  algorithm?: SignAlgorithm;
  /**
   * Default bucket for every request that does not name one itself, so it is
   * configured once instead of on each `signRequest` / `presign` call. An input
   * `bucket` still overrides it. It must not contain `/`, and on virtual-hosted
   * (`*.mi-fds.com`) endpoints it must be a single DNS label.
   */
  bucket?: string;
}

/** Identifies an FDS resource; the URL is built from the configured endpoint. */
export interface ResourceTarget {
  /**
   * Bucket name, overriding the signer's `bucket` option for this request.
   * Omit it to use the configured default, or, when none is configured, for
   * service-level requests (e.g. listing buckets).
   */
  bucket?: string;
  /** Object name, e.g. `path/to/file.png`. Encoded by the library. */
  object?: string;
  /** Sub-resources, e.g. `['acl']` or `{ uploadId: 'abc', partNumber: 1 }`. */
  subResources?: SubResources;
  /** Target the CDN endpoint instead of the service endpoint. */
  cdn?: boolean;
  url?: never;
}

/** Signs an explicit, already-built URL instead of a bucket/object target. */
export interface UrlTarget {
  /** Absolute request URL. */
  url: string;
  bucket?: never;
  object?: never;
  subResources?: never;
  cdn?: never;
  query?: never;
}

/** Headers accepted as input; each name may appear only once. */
export type RequestHeaders = Record<string, string> | Headers | Iterable<readonly [string, string]>;

/** Input of {@link FdsSigner.signRequest}. */
export type SignRequestInput = (ResourceTarget | UrlTarget) & {
  /** HTTP method; defaults to GET. Case-insensitive. */
  method?: HttpMethod | Lowercase<HttpMethod>;
  /**
   * Additional query parameters (e.g. `{ prefix: 'a/' }`). They are sent but,
   * unlike sub-resources, not covered by the signature.
   */
  query?: Record<string, string | number>;
  /**
   * Headers to sign and send, e.g. `content-type`, `content-md5`,
   * `x-xiaomi-meta-*`. All of them are returned in {@link SignedRequest.headers}.
   */
  headers?: RequestHeaders;
  /** Request time used for the date header; defaults to now. */
  date?: Date;
};

/** Input of {@link FdsSigner.presign}. */
export type PresignInput = ResourceTarget & {
  /** Overrides the signer's `bucket` option; required when the signer has none. */
  bucket?: string;
  /** HTTP method the URL will be used with; defaults to GET. Case-insensitive. */
  method?: HttpMethod | Lowercase<HttpMethod>;
  /** Absolute expiration (`Date` or epoch milliseconds). Takes precedence over `expiresIn`. */
  expires?: Date | number;
  /** Lifetime in seconds, relative to now. Defaults to 900 (15 minutes). */
  expiresIn?: number;
  /**
   * Headers covered by the signature (`content-type`, `content-md5`,
   * `x-xiaomi-*`). The client must send exactly these headers, so they are
   * returned in {@link PresignedRequest.headers}.
   */
  headers?: RequestHeaders;
};

/**
 * A request ready to send. Plain, JSON-serializable data: return it from a
 * server / edge function to a browser, or pass it straight to `fetch`:
 *
 * ```ts
 * const req = await signer.signRequest({ bucket, object });
 * const res = await fetch(req.url, req); // add `body` for uploads
 * ```
 */
export interface SignedRequest {
  url: string;
  method: HttpMethod;
  /** Headers to send verbatim (lower-case names), including `authorization`. */
  headers: Record<string, string>;
}

/** A pre-signed request: like {@link SignedRequest}, without `authorization`. */
export interface PresignedRequest extends SignedRequest {
  /** Expiration as epoch milliseconds. */
  expiresAt: number;
}

/** A configured signer; see {@link createSigner}. */
export interface FdsSigner {
  /** The access key id requests are signed with. */
  readonly accessId: string;
  /** Builds a request authenticated with an `Authorization` header. */
  signRequest(input: SignRequestInput): Promise<SignedRequest>;
  /** Builds a pre-signed URL (credentials in the query string). */
  presign(input: PresignInput): Promise<PresignedRequest>;
}

const DEFAULT_EXPIRES_IN_SECONDS = 15 * 60;

/** A single DNS label: what a bucket must be to serve as a subdomain. */
const DNS_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/**
 * Query parameter names (lower-cased) that the signature interprets, so they
 * cannot be passed as unsigned `query` parameters.
 */
const RESERVED_QUERY_NAMES: ReadonlySet<string> = new Set(
  [...SUB_RESOURCE_SET, Common.GALAXY_ACCESS_KEY_ID, Common.SIGNATURE, Common.EXPIRES].map((n) =>
    n.toLowerCase(),
  ),
);

/**
 * Creates a signer bound to a credential and an endpoint.
 *
 * ```ts
 * const signer = createSigner({
 *   accessId: env.FDS_ACCESS_ID,
 *   accessSecret: env.FDS_ACCESS_SECRET,
 *   endpoint: 'cnbj1.fds.api.xiaomi.com',
 * });
 * ```
 *
 * Runs on any runtime with Web Crypto: Node.js >= 22, Cloudflare Workers,
 * Vercel Edge, Deno, Bun. Configuration errors throw synchronously.
 */
export function createSigner(options: SignerOptions): FdsSigner {
  if (options === null || typeof options !== 'object') {
    throw new GalaxyFDSSignerError('INVALID_OPTIONS', 'options must be an object', {
      field: 'options',
    });
  }
  const accessId = requireString(options.accessId, 'accessId', 'INVALID_CREDENTIALS');
  const accessSecret = requireString(options.accessSecret, 'accessSecret', 'INVALID_CREDENTIALS');
  const algorithm = toSignAlgorithm(options.algorithm ?? SignAlgorithm.HmacSHA1);
  const config = new FDSEndpointConfiguration(options);
  // Fail fast on a bad default bucket rather than on the first request that uses it.
  const defaultBucket = resolveDefaultBucket(options.bucket, config);

  const resolveUrl = (target: ResourceTarget, bucket: string | undefined, extraQuery: string[]) => {
    const { object = '', cdn = false } = target;
    if (typeof cdn !== 'boolean') {
      // A truthy string such as 'false' would otherwise silently select the CDN.
      throw new GalaxyFDSSignerError('INVALID_INPUT', 'cdn must be a boolean', { field: 'cdn' });
    }
    if (bucket === undefined) {
      if (object !== '' || target.subResources !== undefined) {
        throw new GalaxyFDSSignerError(
          'INVALID_BUCKET',
          'object and subResources require a bucket',
          { field: 'bucket' },
        );
      }
    } else {
      validateBucket(bucket);
    }
    if (typeof object !== 'string') {
      throw new GalaxyFDSSignerError('INVALID_OBJECT', 'object must be a string', {
        field: 'object',
      });
    }
    const query = [...formatSubResources(target.subResources), ...extraQuery];
    const base = cdn ? config.getCdnBaseUri() : config.getBaseUri();
    return buildUrl(applyVirtualAddressing(config, base, bucket), bucket, object, query);
  };

  async function signRequest(input: SignRequestInput): Promise<SignedRequest> {
    requireInput(input, 'signRequest');
    const method = toHttpMethod(input.method ?? HttpMethod.GET);
    const headers = toHeaderRecord(input.headers);
    const extraQuery = toQueryParams(input.query);

    let url: string;
    if (input.url !== undefined) {
      const mixed = (['bucket', 'object', 'subResources', 'cdn', 'query'] as const).filter(
        (k) => (input as unknown as Record<string, unknown>)[k] !== undefined,
      );
      if (mixed.length > 0) {
        throw new GalaxyFDSSignerError(
          'INVALID_URL',
          `url cannot be combined with ${mixed.join(', ')}`,
          { field: 'url' },
        );
      }
      url = requireString(input.url, 'url', 'INVALID_URL');
    } else {
      url = resolveUrl(input, input.bucket ?? defaultBucket, extraQuery);
    }

    if (headers[Common.DATE] === undefined && headers[XiaomiHeader.DATE] === undefined) {
      // Browsers forbid setting `Date` from script; x-xiaomi-date is the
      // Galaxy-V2 equivalent and works everywhere.
      const date = input.date ?? new Date();
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        throw new GalaxyFDSSignerError('INVALID_DATE', 'date must be a valid Date', {
          field: 'date',
        });
      }
      headers[XiaomiHeader.DATE] = date.toUTCString();
    }

    const authorization = await Signer.getAuthorizationHeader(
      method,
      url,
      headers,
      accessId,
      accessSecret,
      algorithm,
    );
    return { url, method, headers: { ...headers, authorization } };
  }

  async function presign(input: PresignInput): Promise<PresignedRequest> {
    requireInput(input, 'presign');
    const method = toHttpMethod(input.method ?? HttpMethod.GET);
    const headers = toHeaderRecord(input.headers);
    const expiresAt = resolveExpiration(input.expires, input.expiresIn);
    const bucket = input.bucket ?? defaultBucket;
    if (bucket === undefined) {
      throw new GalaxyFDSSignerError('INVALID_BUCKET', 'bucket must be a non-empty string', {
        field: 'bucket',
      });
    }
    // Validate the target (and build the base URL) before signing.
    const resourceUrl = resolveUrl(input, bucket, []);
    const { origin } = new URL(resourceUrl);

    const url = await Signer.generatePresignedUri({
      baseUri: origin + '/',
      bucketName: bucket,
      objectName: input.object ?? '',
      subResources: input.subResources,
      expiration: expiresAt,
      method,
      accessId,
      accessSecret,
      algorithm,
      headers,
    });
    return { url, method, headers, expiresAt };
  }

  return Object.freeze({ accessId, signRequest, presign });
}

/**
 * One-shot form of {@link FdsSigner.signRequest}. Configuration errors reject
 * the returned promise.
 */
export async function signRequest(
  options: SignerOptions,
  input: SignRequestInput,
): Promise<SignedRequest> {
  return createSigner(options).signRequest(input);
}

/**
 * One-shot form of {@link FdsSigner.presign}. Configuration errors reject the
 * returned promise.
 */
export async function presign(
  options: SignerOptions,
  input: PresignInput,
): Promise<PresignedRequest> {
  return createSigner(options).presign(input);
}

function resolveExpiration(
  expires: Date | number | undefined,
  expiresIn: number | undefined,
): number {
  let millis: number;
  if (expires !== undefined) {
    millis = toExpiresMillis(expires, 'expires');
  } else {
    const seconds = expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      throw new GalaxyFDSSignerError(
        'INVALID_EXPIRATION',
        'expiresIn must be a positive number of seconds',
        { field: 'expiresIn' },
      );
    }
    millis = Date.now() + Math.round(seconds * 1000);
    if (!Number.isSafeInteger(millis)) {
      throw new GalaxyFDSSignerError('INVALID_EXPIRATION', `expiresIn ${seconds} is too large`, {
        field: 'expiresIn',
      });
    }
  }
  if (millis <= Date.now()) {
    throw new GalaxyFDSSignerError('INVALID_EXPIRATION', 'expiration must be in the future', {
      field: expires !== undefined ? 'expires' : 'expiresIn',
    });
  }
  return millis;
}

/**
 * Validates the signer's default bucket once, at configuration time, so a
 * mistake surfaces from `createSigner` instead of from every request. The
 * code is `INVALID_BUCKET_OPTION` (config) to keep it apart from the
 * `INVALID_BUCKET` (input) a request raises.
 */
function resolveDefaultBucket(
  bucket: string | undefined,
  config: FDSEndpointConfiguration,
): string | undefined {
  if (bucket === undefined) {
    return undefined;
  }
  validateBucket(bucket, 'INVALID_BUCKET_OPTION');
  if (config.shouldUseVirtualAddressing()) {
    assertDnsLabel(bucket, 'INVALID_BUCKET_OPTION');
  }
  return bucket;
}

/**
 * Rejects a `signRequest` / `presign` call made without an input object. The
 * methods are typed to require one, but a plain-JavaScript caller can omit it;
 * without this guard the body would throw a raw `TypeError`, breaking the
 * "every failure is a `GalaxyFDSSignerError`" contract.
 */
function requireInput(input: unknown, name: string): void {
  if (input === null || typeof input !== 'object') {
    throw new GalaxyFDSSignerError('INVALID_INPUT', `${name} input must be an object`, {
      field: 'input',
    });
  }
}

function validateBucket(
  bucket: unknown,
  code: GalaxyFDSSignerErrorCode = 'INVALID_BUCKET',
): asserts bucket is string {
  requireString(bucket, 'bucket', code);
  if ((bucket as string).includes('/')) {
    throw new GalaxyFDSSignerError(code, `bucket must not contain "/": ${bucket as string}`, {
      field: 'bucket',
    });
  }
}

function assertDnsLabel(bucket: string, code: GalaxyFDSSignerErrorCode): void {
  if (!DNS_LABEL.test(bucket)) {
    // The bucket becomes a subdomain: anything but a single DNS label
    // (e.g. "a.b", "x@evil.com") would change the target host.
    throw new GalaxyFDSSignerError(
      code,
      `bucket ${JSON.stringify(bucket)} cannot be used with virtual-hosted addressing: ` +
        'it must be a DNS label (letters, digits and inner hyphens, at most 63 characters)',
      { field: 'bucket' },
    );
  }
}

/**
 * Validates and renders the unsigned extra query parameters (`?prefix=…`).
 * Rejects anything but a `Record<string, string | number>`: `Object.entries` on
 * a malformed value (a string, say) would otherwise silently produce a bogus
 * URL instead of an error.
 */
function toQueryParams(query: unknown): string[] {
  if (query === undefined) {
    return [];
  }
  if (query === null || typeof query !== 'object' || Array.isArray(query)) {
    throw new GalaxyFDSSignerError(
      'INVALID_QUERY',
      'query must be an object of string or number values',
      { field: 'query' },
    );
  }
  const params: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (RESERVED_QUERY_NAMES.has(key.toLowerCase())) {
      // A sub-resource here would be signed (or override the one in
      // `subResources`), and `Expires` would turn the date line of the
      // signature into an expiration: neither is the unsigned parameter the
      // caller asked for.
      throw new GalaxyFDSSignerError(
        'INVALID_QUERY',
        `query parameter ${JSON.stringify(key)} is reserved: ` +
          'pass sub-resources via subResources, and use presign for pre-signed URLs',
        { field: 'query' },
      );
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new GalaxyFDSSignerError(
        'INVALID_QUERY',
        `invalid value for query parameter ${JSON.stringify(key)}: ` +
          'expected a string or number',
        { field: 'query' },
      );
    }
    params.push(`${urlEncode(key)}=${urlEncode(String(value))}`);
  }
  return params;
}

/**
 * Normalizes input headers to a plain object with lower-case names. A name
 * given twice is rejected: the signature would join the values with "," while
 * HTTP clients join them with ", ", so the request could not verify.
 */
function toHeaderRecord(input: RequestHeaders | undefined): Record<string, string> {
  const map = wrapErrors(
    'INVALID_HEADERS',
    'invalid headers',
    () => HeaderMultiMap.from(input as HttpHeaders),
    'headers',
  );
  const out: Record<string, string> = {};
  for (const [name, value] of map) {
    if (Object.hasOwn(out, name)) {
      throw new GalaxyFDSSignerError(
        'INVALID_HEADERS',
        `header "${name}" is given more than once`,
        {
          field: 'headers',
        },
      );
    }
    out[name] = value;
  }
  return out;
}

/** `{origin}/{bucket}/{object}?{query}`, path-encoded like java.net.URI. */
function buildUrl(
  baseUri: string,
  bucket: string | undefined,
  object: string,
  query: string[],
): string {
  return wrapErrors('INVALID_ENDPOINT', 'invalid endpoint', () => {
    const base = new URL(baseUri);
    let path = '/';
    if (bucket !== undefined) {
      path = encodeUriPath('/' + bucket + (object.length > 0 ? '/' + object : ''));
    }
    const port = base.port === '' ? '' : `:${base.port}`;
    const search = query.length > 0 ? '?' + query.join('&') : '';
    return `${base.protocol}//${base.hostname}${port}${path}${search}`;
  });
}

/**
 * Rewrites the host of `baseUri` to virtual-hosted style (`{bucket}.{endpoint}`)
 * when the endpoint uses `*.mi-fds.com` addressing. Mirrors the Java SDK,
 * which keeps the bucket in the path too. The host is not signed, so the
 * signature is unaffected.
 */
function applyVirtualAddressing(
  config: FDSEndpointConfiguration,
  baseUri: string,
  bucket: string | undefined,
): string {
  const endpoint = config.endpoint;
  if (!config.shouldUseVirtualAddressing() || endpoint === undefined || bucket === undefined) {
    return baseUri;
  }
  const url = new URL(baseUri);
  if (url.hostname !== endpoint.split(':')[0]) {
    return baseUri;
  }
  assertDnsLabel(bucket, 'INVALID_BUCKET');
  return `${url.protocol}//${bucket}.${url.host}/`;
}
