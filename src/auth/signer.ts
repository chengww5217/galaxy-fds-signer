import { createHmac } from 'node:crypto';

import { Common, GALAXY_V2_PREFIX, MULTIPART_FORM_DATA } from '../common.js';
import { HttpMethod, SIGN_ALGORITHM_DIGEST, SignAlgorithm, SUB_RESOURCE_SET } from '../enums.js';
import { GalaxyFDSClientException } from '../errors.js';
import { parseUri, parseUriParameters, urlEncode } from './utils.js';

/**
 * Case-insensitive multimap of HTTP headers, preserving insertion order and
 * allowing multiple values per key. Mirrors the Guava `LinkedListMultimap`
 * used by the Java SDK.
 *
 * Accepts plain objects where values may be a single string or an array.
 */
export type HttpHeaders = Record<string, string | string[]> | HeaderMultiMap;

/** Ordered, multi-valued header container with case-insensitive lookup by lower-cased key. */
export class HeaderMultiMap {
  private readonly entriesList: Array<[string, string]> = [];

  /** Builds a multimap from a plain headers object. */
  static from(headers?: HttpHeaders): HeaderMultiMap {
    if (headers instanceof HeaderMultiMap) {
      return headers;
    }
    const map = new HeaderMultiMap();
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            map.put(key, v);
          }
        } else {
          map.put(key, value);
        }
      }
    }
    return map;
  }

  put(key: string, value: string): void {
    this.entriesList.push([key, value]);
  }

  /** All original (key, value) entries in insertion order. */
  entries(): ReadonlyArray<[string, string]> {
    return this.entriesList;
  }

  /**
   * Returns all values whose key equals `name` ignoring case, in insertion order.
   */
  get(name: string): string[] {
    const lower = name.toLowerCase();
    const values: string[] = [];
    for (const [k, v] of this.entriesList) {
      if (k.toLowerCase() === lower) {
        values.push(v);
      }
    }
    return values;
  }

  /** First value for `name` (case-insensitive), or empty string when absent. */
  getFirst(name: string): string {
    const values = this.get(name);
    return values.length > 0 ? values[0] : '';
  }
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
    secretAccessKeyId: string,
    algorithm: SignAlgorithm = SignAlgorithm.HmacSHA1,
  ): Buffer {
    const headers = HeaderMultiMap.from(httpHeaders);
    const stringToSign = constructStringToSign(httpMethod, uri, headers);
    const digest = SIGN_ALGORITHM_DIGEST[algorithm];
    return createHmac(digest, secretAccessKeyId).update(stringToSign, 'utf-8').digest();
  },

  /** Signs the request and returns the Base64-encoded signature. */
  signToBase64(
    httpMethod: HttpMethod,
    uri: string,
    httpHeaders: HttpHeaders | undefined,
    secretAccessKeyId: string,
    algorithm: SignAlgorithm = SignAlgorithm.HmacSHA1,
  ): string {
    return this.sign(httpMethod, uri, httpHeaders, secretAccessKeyId, algorithm).toString('base64');
  },

  /**
   * Builds the value of the `Authorization` HTTP header:
   * `Galaxy-V2 {accessKeyId}:{base64signature}`.
   */
  getAuthorizationHeader(
    httpMethod: HttpMethod,
    uri: string,
    httpHeaders: HttpHeaders | undefined,
    accessKeyId: string,
    secretAccessKeyId: string,
    algorithm: SignAlgorithm = SignAlgorithm.HmacSHA1,
  ): string {
    const signature = this.signToBase64(
      httpMethod,
      uri,
      httpHeaders,
      secretAccessKeyId,
      algorithm,
    );
    return GALAXY_V2_PREFIX + accessKeyId + ':' + signature;
  },

  /**
   * Generates a pre-signed URI granting temporary access to a resource.
   *
   * @param baseUri      The service base URI, e.g. `http://files.fds.api.xiaomi.com/`.
   * @param bucketName   The bucket name.
   * @param objectName   The object name, or empty for bucket-level resources.
   * @param subResources Sub-resource query fragments (e.g. `["acl"]`), or `null`.
   * @param expiration   Expiration time; a `Date` or epoch milliseconds.
   * @param httpMethod   The HTTP method the URI will be used with.
   * @param accessId     The access key id.
   * @param accessSecret The secret access key.
   * @param algorithm    The signature algorithm (defaults to HmacSHA1).
   * @param httpHeaders  Optional headers participating in the signature.
   */
  generatePresignedUri(
    baseUri: string,
    bucketName: string,
    objectName: string | null,
    subResources: string[] | null,
    expiration: Date | number,
    httpMethod: HttpMethod,
    accessId: string,
    accessSecret: string,
    algorithm: SignAlgorithm = SignAlgorithm.HmacSHA1,
    httpHeaders?: HttpHeaders,
  ): string {
    try {
      const base = new URL(baseUri);
      const objectPart = objectName != null && objectName.length > 0 ? '/' + objectName : '';
      const expiresMillis = expiration instanceof Date ? expiration.getTime() : expiration;

      const path = '/' + bucketName + objectPart;
      const queryParts: string[] = [];
      if (subResources != null && subResources.length > 0) {
        queryParts.push(subResources.join('&'));
      }
      queryParts.push(`${Common.GALAXY_ACCESS_KEY_ID}=${accessId}`);
      queryParts.push(`${Common.EXPIRES}=${expiresMillis}`);
      const query = queryParts.join('&');

      const port = base.port === '' ? '' : `:${base.port}`;
      const encodedUri = `${base.protocol}//${base.hostname}${port}${path}?${query}`;

      const signature = this.signToBase64(
        httpMethod,
        encodedUri,
        httpHeaders,
        accessSecret,
        algorithm,
      );
      return `${encodedUri}&${Common.SIGNATURE}=${urlEncode(signature)}`;
    } catch (e) {
      throw new GalaxyFDSClientException('Failed to generate pre-signed URI', { cause: e });
    }
  },
};

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
  httpHeaders: HeaderMultiMap,
): string {
  const parts = parseUri(uri);
  let builder = '';
  builder += httpMethod + '\n';
  builder += httpHeaders.getFirst(Common.CONTENT_MD5) + '\n';
  builder += getContentType(httpHeaders) + '\n';

  const expires = getExpires(parts.query);
  if (expires > 0) {
    // For a pre-signed URI the expiration replaces the date line.
    builder += expires + '\n';
  } else {
    const xiaomiDate = httpHeaders.getFirst('x-xiaomi-date');
    const date = xiaomiDate === '' ? httpHeaders.getFirst(Common.DATE) : '';
    builder += date + '\n';
  }

  builder += canonicalizeXiaomiHeaders(httpHeaders);
  builder += canonicalizeResource(parts.path, parts.query);
  return builder;
}

/**
 * Canonicalizes the `x-xiaomi-` headers: keys lower-cased, multiple values for
 * the same key joined by `,`, sorted lexicographically by key, each rendered
 * as `key:value\n`.
 */
export function canonicalizeXiaomiHeaders(headers: HeaderMultiMap): string {
  if (!headers) {
    return '';
  }

  // Group by lower-cased key, joining multiple values with ",".
  const sorted = new Map<string, string[]>();
  for (const [k] of headers.entries()) {
    const key = k.toLowerCase();
    if (!key.startsWith(Common.XIAOMI_HEADER_PREFIX)) {
      continue;
    }
    if (!sorted.has(key)) {
      // Collect every value for this original-cased key once.
      sorted.set(key, headers.get(k));
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
export function canonicalizeResource(path: string, query: string | null): string {
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
function getExpires(query: string | null): number {
  for (const [key, value] of parseUriParameters(query)) {
    if (key === Common.EXPIRES) {
      return Number.parseInt(value, 10);
    }
  }
  return 0;
}
