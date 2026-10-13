import { FDSEndpointConfiguration, type FDSEndpointOptions } from './config.js';
import { Common } from './common.js';
import { HttpMethod, SignAlgorithm, toHttpMethod, toSignAlgorithm, XiaomiHeader } from './enums.js';
import { GalaxyFDSSignerError, requireString, wrapErrors } from './errors.js';
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
}

/** Identifies an FDS resource; the URL is built from the configured endpoint. */
export interface ResourceTarget {
  /** Bucket name. Omit only for service-level requests (e.g. listing buckets). */
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
export type PresignInput = Omit<ResourceTarget, 'bucket'> & {
  /** Bucket name. */
  bucket: string;
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
 * Runs on any runtime with Web Crypto: Node.js >= 20, Cloudflare Workers,
 * Vercel Edge, Deno, Bun. Configuration errors throw synchronously.
 */
export function createSigner(options: SignerOptions): FdsSigner {
  if (options === null || typeof options !== 'object') {
    throw new GalaxyFDSSignerError('options must be an object');
  }
  const accessId = requireString(options.accessId, 'accessId');
  const accessSecret = requireString(options.accessSecret, 'accessSecret');
  const algorithm = toSignAlgorithm(options.algorithm ?? SignAlgorithm.HmacSHA1);
  const config = new FDSEndpointConfiguration(options);

  const resolveUrl = (target: ResourceTarget, extraQuery: string[], requireBucket: boolean) => {
    const { bucket, object = '', cdn = false } = target;
    if (bucket === undefined) {
      if (requireBucket) {
        throw new GalaxyFDSSignerError('bucket must be a non-empty string');
      }
      if (object !== '' || target.subResources !== undefined) {
        throw new GalaxyFDSSignerError('object and subResources require a bucket');
      }
    } else {
      validateBucket(bucket);
    }
    if (typeof object !== 'string') {
      throw new GalaxyFDSSignerError('object must be a string');
    }
    const query = [...formatSubResources(target.subResources), ...extraQuery];
    const base = cdn ? config.getCdnBaseUri() : config.getBaseUri();
    return buildUrl(applyVirtualAddressing(config, base, bucket), bucket, object, query);
  };

  async function signRequest(input: SignRequestInput): Promise<SignedRequest> {
    const method = toHttpMethod(input?.method ?? HttpMethod.GET);
    const headers = toHeaderRecord(input.headers);
    const extraQuery = Object.entries(input.query ?? {}).map(
      ([k, v]) => `${urlEncode(k)}=${urlEncode(String(v))}`,
    );

    let url: string;
    if (input.url !== undefined) {
      const mixed = (['bucket', 'object', 'subResources', 'cdn', 'query'] as const).filter(
        (k) => (input as unknown as Record<string, unknown>)[k] !== undefined,
      );
      if (mixed.length > 0) {
        throw new GalaxyFDSSignerError(`url cannot be combined with ${mixed.join(', ')}`);
      }
      url = requireString(input.url, 'url');
    } else {
      url = resolveUrl(input, extraQuery, false);
    }

    if (headers[Common.DATE] === undefined && headers[XiaomiHeader.DATE] === undefined) {
      // Browsers forbid setting `Date` from script; x-xiaomi-date is the
      // Galaxy-V2 equivalent and works everywhere.
      const date = input.date ?? new Date();
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        throw new GalaxyFDSSignerError('date must be a valid Date');
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
    const method = toHttpMethod(input?.method ?? HttpMethod.GET);
    const headers = toHeaderRecord(input.headers);
    const expiresAt = resolveExpiration(input.expires, input.expiresIn);
    // Validate the target (and build the base URL) before signing.
    const resourceUrl = resolveUrl(input, [], true);
    const { origin } = new URL(resourceUrl);

    const url = await Signer.generatePresignedUri({
      baseUri: origin + '/',
      bucketName: input.bucket,
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
    millis = toExpiresMillis(expires);
  } else {
    const seconds = expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      throw new GalaxyFDSSignerError('expiresIn must be a positive number of seconds');
    }
    millis = Date.now() + Math.round(seconds * 1000);
  }
  if (millis <= Date.now()) {
    throw new GalaxyFDSSignerError('expiration must be in the future');
  }
  return millis;
}

function validateBucket(bucket: unknown): asserts bucket is string {
  requireString(bucket, 'bucket');
  if ((bucket as string).includes('/')) {
    throw new GalaxyFDSSignerError(`bucket must not contain "/": ${bucket as string}`);
  }
}

/**
 * Normalizes input headers to a plain object with lower-case names. A name
 * given twice is rejected: the signature would join the values with "," while
 * HTTP clients join them with ", ", so the request could not verify.
 */
function toHeaderRecord(input: RequestHeaders | undefined): Record<string, string> {
  const map = wrapErrors('invalid headers', () => HeaderMultiMap.from(input as HttpHeaders));
  const out: Record<string, string> = {};
  for (const [name, value] of map) {
    if (Object.hasOwn(out, name)) {
      throw new GalaxyFDSSignerError(`header "${name}" is given more than once`);
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
  return wrapErrors('invalid endpoint', () => {
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
  if (url.hostname !== endpoint.split(':')[0].toLowerCase()) {
    return baseUri;
  }
  if (!DNS_LABEL.test(bucket)) {
    // The bucket becomes a subdomain: anything but a single DNS label
    // (e.g. "a.b", "x@evil.com") would change the target host.
    throw new GalaxyFDSSignerError(
      `bucket ${JSON.stringify(bucket)} cannot be used with virtual-hosted addressing: ` +
        'it must be a DNS label (letters, digits and inner hyphens, at most 63 characters)',
    );
  }
  return `${url.protocol}//${bucket}.${url.host}/`;
}
