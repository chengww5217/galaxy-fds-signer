import { createHmac } from 'node:crypto';

import { Common, GALAXY_V2_PREFIX, MULTIPART_FORM_DATA } from '../common.js';
import {
  HttpMethod,
  SIGN_ALGORITHM_DIGEST,
  SignAlgorithm,
  SUB_RESOURCE_SET,
  SubResource,
  toHttpMethod,
  toSignAlgorithm,
  XiaomiHeader,
} from '../enums.js';
import { GalaxyFDSSignerError } from '../errors.js';
import { encodeUriPath, parseUri, parseUriParameters, urlEncode } from './utils.js';

/**
 * Headers participating in a signature. Accepts a plain object (values may be
 * a single string or an array), a list of `[name, value]` pairs, a WHATWG
 * `Headers` instance, or a {@link HeaderMultiMap}.
 *
 * Header names are case-insensitive, as in HTTP: `Content-Type` and
 * `content-type` are the same header.
 */
export type HttpHeaders =
  Record<string, string | string[]> | Iterable<readonly [string, string]> | Headers;

/**
 * Ordered, multi-valued header container. Names are normalized to lower case
 * so lookups are case-insensitive.
 *
 * The Java SDK uses a case-sensitive Guava `LinkedListMultimap` and only
 * recognizes lower-case names; for lower-case input the two behave
 * identically, while mixed-case input no longer silently drops headers.
 */
export class HeaderMultiMap implements Iterable<[string, string]> {
  private readonly entriesList: Array<[string, string]> = [];

  [Symbol.iterator](): Iterator<[string, string]> {
    return this.entriesList[Symbol.iterator]();
  }

  /** Builds a multimap from any supported headers shape. */
  static from(headers?: HttpHeaders): HeaderMultiMap {
    if (headers instanceof HeaderMultiMap) {
      return headers;
    }
    const map = new HeaderMultiMap();
    if (headers === undefined || headers === null) {
      return map;
    }
    if (isIterable(headers)) {
      for (const [key, value] of headers) {
        map.put(key, value);
      }
      return map;
    }
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          map.put(key, v);
        }
      } else {
        map.put(key, value);
      }
    }
    return map;
  }

  put(key: string, value: string): void {
    this.entriesList.push([key.toLowerCase(), String(value)]);
  }

  /** All (lower-cased key, value) entries in insertion order. */
  entries(): ReadonlyArray<[string, string]> {
    return this.entriesList;
  }

  /** Returns all values for `name` (case-insensitive), in insertion order. */
  get(name: string): string[] {
    const key = name.toLowerCase();
    const values: string[] = [];
    for (const [k, v] of this.entriesList) {
      if (k === key) {
        values.push(v);
      }
    }
    return values;
  }

  /** Whether at least one value is present for `name` (case-insensitive). */
  has(name: string): boolean {
    return this.get(name).length > 0;
  }

  /** First value for `name` (case-insensitive), or empty string when absent. */
  getFirst(name: string): string {
    const values = this.get(name);
    return values.length > 0 ? values[0] : '';
  }
}

function isIterable(value: object): value is Iterable<readonly [string, string]> {
  return typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}

/**
 * Sub-resources of a pre-signed URI, either as a list of value-less names
 * (`['acl']`) or as a map of name to value
 * (`{ uploadId: 'abc', partNumber: 1, acl: true }`). Values are URL-encoded;
 * `true` renders the bare name, `false`/`undefined` omits it.
 *
 * Only {@link SubResource} names are accepted: other query parameters are not
 * covered by the signature, so silently passing them along would be unsafe.
 */
export type SubResources =
  ReadonlyArray<SubResource> | Partial<Record<SubResource, string | number | boolean | undefined>>;

/** Renders {@link SubResources} as query fragments, validating the names. */
export function formatSubResources(subResources: SubResources | undefined): string[] {
  if (subResources === undefined) {
    return [];
  }
  const entries: Array<[string, unknown]> = Array.isArray(subResources)
    ? subResources.map((name) => [name, true])
    : Object.entries(subResources);
  const parts: string[] = [];
  for (const [name, value] of entries) {
    if (!SUB_RESOURCE_SET.has(name)) {
      throw new GalaxyFDSSignerError(
        `unsupported sub-resource: ${JSON.stringify(name)} (expected one of ${[...SUB_RESOURCE_SET].join(', ')})`,
      );
    }
    if (value === undefined || value === false) {
      continue;
    }
    if (value === true) {
      parts.push(name);
    } else if (typeof value === 'string' || typeof value === 'number') {
      parts.push(`${name}=${urlEncode(String(value))}`);
    } else {
      throw new GalaxyFDSSignerError(`invalid value for sub-resource ${name}: ${String(value)}`);
    }
  }
  return parts;
}

/** Parameters of {@link Signer.generatePresignedUri}. */
export interface PresignUriInput {
  /** The service base URI, e.g. `http://files.fds.api.xiaomi.com/`. */
  baseUri: string;
  /** The bucket name. */
  bucketName: string;
  /** The object name; omit or leave empty for bucket-level resources. */
  objectName?: string;
  /** Sub-resources to include in (and sign into) the query. */
  subResources?: SubResources;
  /** Expiration time; a `Date` or epoch milliseconds. */
  expiration: Date | number;
  /** The HTTP method the URI will be used with (defaults to GET). */
  method?: HttpMethod;
  /** The access key id. */
  accessId: string;
  /** The secret access key. */
  accessSecret: string;
  /** The signature algorithm (defaults to HmacSHA1). */
  algorithm?: SignAlgorithm;
  /** Optional headers participating in the signature (content-type / content-md5). */
  headers?: HttpHeaders;
}

/**
 * Signs Galaxy FDS requests and builds pre-signed URIs.
 *
 * Ported from `com.xiaomi.infra.galaxy.fds.auth.signature.Signer`.
 */
export const Signer = {
  /**
   * Signs the request and returns the raw signature bytes.
   *
   * @see {@link signToBase64} for the Base64-encoded variant.
   */
  sign(
    httpMethod: HttpMethod,
    uri: string,
    httpHeaders: HttpHeaders | undefined,
    accessSecret: string,
    algorithm: SignAlgorithm = SignAlgorithm.HmacSHA1,
  ): Buffer {
    const headers = HeaderMultiMap.from(httpHeaders);
    const stringToSign = constructStringToSign(httpMethod, uri, headers);
    const digest = SIGN_ALGORITHM_DIGEST[toSignAlgorithm(algorithm)];
    return createHmac(digest, accessSecret).update(stringToSign, 'utf-8').digest();
  },

  /** Signs the request and returns the Base64-encoded signature. */
  signToBase64(
    httpMethod: HttpMethod,
    uri: string,
    httpHeaders: HttpHeaders | undefined,
    accessSecret: string,
    algorithm: SignAlgorithm = SignAlgorithm.HmacSHA1,
  ): string {
    return Signer.sign(httpMethod, uri, httpHeaders, accessSecret, algorithm).toString('base64');
  },

  /**
   * Builds the value of the `Authorization` HTTP header:
   * `Galaxy-V2 {accessKeyId}:{base64signature}`.
   *
   * @throws GalaxyFDSSignerError when neither a `date` nor an
   *         `x-xiaomi-date` header is present (and the URI carries no
   *         `Expires`): the server rejects such requests, so the signature
   *         would be useless.
   */
  getAuthorizationHeader(
    httpMethod: HttpMethod,
    uri: string,
    httpHeaders: HttpHeaders | undefined,
    accessKeyId: string,
    accessSecret: string,
    algorithm: SignAlgorithm = SignAlgorithm.HmacSHA1,
  ): string {
    const headers = HeaderMultiMap.from(httpHeaders);
    if (
      !headers.has(Common.DATE) &&
      !headers.has(XiaomiHeader.DATE) &&
      getExpires(parseUri(uri).query) <= 0
    ) {
      throw new GalaxyFDSSignerError(
        `a "${Common.DATE}" or "${XiaomiHeader.DATE}" header is required to sign a request`,
      );
    }
    const signature = Signer.signToBase64(httpMethod, uri, headers, accessSecret, algorithm);
    return GALAXY_V2_PREFIX + accessKeyId + ':' + signature;
  },

  /**
   * Generates a pre-signed URI granting temporary access to a resource.
   *
   * @see {@link PresignUriInput} for the parameters.
   */
  generatePresignedUri({
    baseUri,
    bucketName,
    objectName = '',
    subResources,
    expiration,
    method = HttpMethod.GET,
    accessId,
    accessSecret,
    algorithm = SignAlgorithm.HmacSHA1,
    headers: httpHeaders,
  }: PresignUriInput): string {
    if (typeof bucketName !== 'string' || bucketName.length === 0) {
      throw new GalaxyFDSSignerError('bucketName must be a non-empty string');
    }
    const expiresMillis = toExpiresMillis(expiration);
    const subResourceParts = formatSubResources(subResources);

    try {
      const base = new URL(baseUri);
      const objectPart = objectName.length > 0 ? '/' + objectName : '';

      // Encode the path as java.net.URI's constructor would. Signing re-parses
      // this URI and decodes the path back, so the signature is unaffected.
      const path = encodeUriPath('/' + bucketName + objectPart);
      const queryParts: string[] = [];
      queryParts.push(...subResourceParts);
      queryParts.push(`${Common.GALAXY_ACCESS_KEY_ID}=${accessId}`);
      queryParts.push(`${Common.EXPIRES}=${expiresMillis}`);
      const query = queryParts.join('&');

      const port = base.port === '' ? '' : `:${base.port}`;
      const encodedUri = `${base.protocol}//${base.hostname}${port}${path}?${query}`;

      const signature = Signer.signToBase64(
        method,
        encodedUri,
        httpHeaders,
        accessSecret,
        algorithm,
      );
      return `${encodedUri}&${Common.SIGNATURE}=${urlEncode(signature)}`;
    } catch (e) {
      throw new GalaxyFDSSignerError('Failed to generate pre-signed URI', { cause: e });
    }
  },
};

/**
 * Smallest accepted expiration (2001-09-09T01:46:40Z). Anything below is
 * almost certainly an epoch time in seconds passed by mistake.
 */
const MIN_EXPIRES_MILLIS = 1e12;

/**
 * Validates an expiration and returns it as integer epoch milliseconds.
 *
 * The value ends up verbatim in `Expires=` while the signature uses
 * `parseInt`, so a fractional, zero or negative value would yield a URI whose
 * signature does not match (or that is signed with the date line instead).
 */
export function toExpiresMillis(expiration: Date | number): number {
  const millis = expiration instanceof Date ? expiration.getTime() : expiration;
  if (typeof millis !== 'number' || !Number.isSafeInteger(millis)) {
    throw new GalaxyFDSSignerError(
      'expiration must be a valid Date or an integer epoch time in milliseconds',
    );
  }
  if (millis < MIN_EXPIRES_MILLIS) {
    throw new GalaxyFDSSignerError(
      `expiration ${millis} is too small; it must be in milliseconds (not seconds) since the epoch`,
    );
  }
  return millis;
}

/**
 * Constructs the canonical string to sign.
 *
 * Format (each segment terminated by `\n` except the trailing canonicalized parts):
 * ```
 * {METHOD}\n
 * {content-md5}\n
 * {content-type}\n
 * {date-or-expires}\n
 * {canonicalized x-xiaomi headers}
 * {canonicalized resource}
 * ```
 *
 * Ported from `Signer.constructStringToSign`.
 */
export function constructStringToSign(
  httpMethod: HttpMethod,
  uri: string,
  httpHeaders: HttpHeaders | undefined,
): string {
  const headers = HeaderMultiMap.from(httpHeaders);
  const parts = parseUri(uri);
  let builder = '';
  builder += toHttpMethod(httpMethod) + '\n';
  builder += headers.getFirst(Common.CONTENT_MD5) + '\n';
  builder += getContentType(headers) + '\n';

  const expires = getExpires(parts.query);
  if (expires > 0) {
    // For a pre-signed URI the expiration replaces the date line.
    builder += expires + '\n';
  } else {
    const xiaomiDate = headers.getFirst(XiaomiHeader.DATE);
    const date = xiaomiDate === '' ? headers.getFirst(Common.DATE) : '';
    builder += date + '\n';
  }

  builder += canonicalizeXiaomiHeaders(headers);
  builder += canonicalizeResource(parts.path, parts.query);
  return builder;
}

/**
 * Canonicalizes the `x-xiaomi-` headers: keys lower-cased, multiple values for
 * the same key joined by `,`, sorted lexicographically by key, each rendered
 * as `key:value\n`.
 */
export function canonicalizeXiaomiHeaders(headers: HttpHeaders | undefined): string {
  const map = HeaderMultiMap.from(headers);

  // Keys are already lower-cased; group values per key, joined with ",".
  const sorted = new Map<string, string[]>();
  for (const [key, value] of map.entries()) {
    if (!key.startsWith(Common.XIAOMI_HEADER_PREFIX)) {
      continue;
    }
    const values = sorted.get(key);
    if (values) {
      values.push(value);
    } else {
      sorted.set(key, [value]);
    }
  }

  let result = '';
  for (const key of [...sorted.keys()].sort()) {
    result += key + ':' + sorted.get(key)!.join(',') + '\n';
  }
  return result;
}

/**
 * Canonicalizes the resource: the path followed by the recognized sub-resource
 * query parameters, sorted lexicographically.
 */
export function canonicalizeResource(path: string, query?: string): string {
  let result = path;

  const sortedParams = new Map<string, string>();
  for (const [key, value] of parseUriParameters(query)) {
    if (SUB_RESOURCE_SET.has(key)) {
      sortedParams.set(key, value);
    }
  }

  if (sortedParams.size > 0) {
    result += '?';
    let isFirst = true;
    for (const key of [...sortedParams.keys()].sort()) {
      result += isFirst ? key : '&' + key;
      isFirst = false;
      const value = sortedParams.get(key)!;
      if (value.length > 0) {
        result += '=' + value;
      }
    }
  }
  return result;
}

/**
 * Returns the content type for signing. A `multipart/form-data` value (with any
 * trailing boundary) is collapsed to exactly `multipart/form-data`.
 */
function getContentType(headers: HeaderMultiMap): string {
  let result = headers.getFirst(Common.CONTENT_TYPE);
  if (result.startsWith(MULTIPART_FORM_DATA)) {
    result = MULTIPART_FORM_DATA;
  }
  return result;
}

/** Reads the `Expires` query parameter as a number, or `0` when absent. */
function getExpires(query?: string): number {
  for (const [key, value] of parseUriParameters(query)) {
    if (key === Common.EXPIRES) {
      return Number.parseInt(value, 10);
    }
  }
  return 0;
}
