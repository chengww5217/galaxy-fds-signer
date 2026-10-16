import { Common, GALAXY_V2_PREFIX, MULTIPART_FORM_DATA } from '../common.js';
import {
  HttpMethod,
  SignAlgorithm,
  SUB_RESOURCE_SET,
  SubResource,
  toHttpMethod,
  toSignAlgorithm,
  XiaomiHeader,
} from '../enums.js';
import { GalaxyFDSSignerError, requireString, wrapErrors, wrapErrorsAsync } from '../errors.js';
import { createHmac, type Hmac, toBase64 } from './crypto.js';
import {
  buildResourceUri,
  isWellFormed,
  parseUri,
  parseUriParameters,
  urlEncode,
} from './utils.js';

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

/** An RFC 9110 `token`: the characters allowed in a header name. */
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** Leading/trailing HTTP whitespace, which `fetch` strips from header values. */
const HTTP_WHITESPACE_EDGES = /^[\t\n\r ]+|[\t\n\r ]+$/g;
/** What `Headers` refuses in a (trimmed) value: NUL, CR, LF and non-ByteString characters. */
const INVALID_HEADER_VALUE = /[\0\r\n\u0100-\uffff]/;

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
    if (typeof headers !== 'object') {
      throw new GalaxyFDSSignerError(
        'INVALID_HEADERS',
        'headers must be an object, a Headers instance or a list of [name, value] pairs',
        { field: 'headers' },
      );
    }
    if (isIterable(headers)) {
      for (const entry of headers) {
        if (!Array.isArray(entry) || entry.length !== 2) {
          throw new GalaxyFDSSignerError(
            'INVALID_HEADERS',
            'header entries must be [name, value] pairs',
            { field: 'headers' },
          );
        }
        map.put(entry[0], entry[1]);
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

  /**
   * Adds a header. The name must be an HTTP token and the value is trimmed of
   * leading/trailing HTTP whitespace, exactly as `fetch` / `Headers` do before
   * sending: signing the untrimmed value would yield a signature the server
   * cannot reproduce, and a name or value `Headers` rejects would only fail
   * later, in the caller's `fetch`, as a plain `TypeError`.
   */
  put(key: string, value: string): void {
    if (typeof key !== 'string' || key.length === 0 || typeof value !== 'string') {
      throw new GalaxyFDSSignerError(
        'INVALID_HEADERS',
        `invalid header ${JSON.stringify(key)}: names and values must be strings`,
        { field: 'headers' },
      );
    }
    if (!HTTP_TOKEN.test(key)) {
      throw new GalaxyFDSSignerError(
        'INVALID_HEADERS',
        `invalid header name ${JSON.stringify(key)}: must be an HTTP token`,
        { field: 'headers' },
      );
    }
    const trimmed = value.replace(HTTP_WHITESPACE_EDGES, '');
    if (INVALID_HEADER_VALUE.test(trimmed)) {
      throw new GalaxyFDSSignerError(
        'INVALID_HEADERS',
        `invalid value for header "${key}": must not contain NUL, CR, LF or characters above U+00FF`,
        { field: 'headers' },
      );
    }
    this.entriesList.push([key.toLowerCase(), trimmed]);
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
        'INVALID_SUB_RESOURCE',
        `unsupported sub-resource: ${JSON.stringify(name)} (expected one of ${[...SUB_RESOURCE_SET].join(', ')})`,
        { field: 'subResources' },
      );
    }
    if (value === undefined || value === false) {
      continue;
    }
    if (value === true) {
      parts.push(name);
    } else if (typeof value === 'string' || typeof value === 'number') {
      if (typeof value === 'string' && !isWellFormed(value)) {
        throw new GalaxyFDSSignerError(
          'INVALID_SUB_RESOURCE',
          `invalid value for sub-resource ${name}: contains an unpaired surrogate`,
          { field: 'subResources' },
        );
      }
      parts.push(`${name}=${urlEncode(String(value))}`);
    } else {
      throw new GalaxyFDSSignerError(
        'INVALID_SUB_RESOURCE',
        `invalid value for sub-resource ${name}: ${String(value)}`,
        { field: 'subResources' },
      );
    }
  }
  return parts;
}

/**
 * The secret to sign with: the access secret itself, or a keyed {@link Hmac}
 * from {@link createHmac} that binds the algorithm and key once.
 */
export type SigningSecret = string | Hmac;

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
  /** The secret access key, or a keyed {@link Hmac} (see {@link Signer.sign}). */
  accessSecret: SigningSecret;
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
   * `accessSecret` is either the secret itself or a keyed {@link Hmac} from
   * {@link createHmac}, which binds the algorithm and key once and carries
   * its own algorithm (`algorithm` is then ignored).
   *
   * @see {@link signToBase64} for the Base64-encoded variant.
   */
  sign(
    httpMethod: HttpMethod,
    uri: string,
    httpHeaders: HttpHeaders | undefined,
    accessSecret: SigningSecret,
    algorithm: SignAlgorithm = SignAlgorithm.HmacSHA1,
  ): Promise<Uint8Array> {
    return wrapErrorsAsync('SIGNING_FAILED', 'failed to sign request', () => {
      let mac: Hmac;
      if (typeof accessSecret === 'function') {
        mac = accessSecret;
      } else {
        const secret = requireString(accessSecret, 'accessSecret', 'INVALID_CREDENTIALS');
        mac = createHmac(toSignAlgorithm(algorithm), secret);
      }
      return mac(constructStringToSign(httpMethod, uri, httpHeaders));
    });
  },

  /** Signs the request and returns the Base64-encoded signature. */
  async signToBase64(
    httpMethod: HttpMethod,
    uri: string,
    httpHeaders: HttpHeaders | undefined,
    accessSecret: SigningSecret,
    algorithm: SignAlgorithm = SignAlgorithm.HmacSHA1,
  ): Promise<string> {
    return toBase64(await Signer.sign(httpMethod, uri, httpHeaders, accessSecret, algorithm));
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
  async getAuthorizationHeader(
    httpMethod: HttpMethod,
    uri: string,
    httpHeaders: HttpHeaders | undefined,
    accessKeyId: string,
    accessSecret: SigningSecret,
    algorithm: SignAlgorithm = SignAlgorithm.HmacSHA1,
  ): Promise<string> {
    requireString(accessKeyId, 'accessId', 'INVALID_CREDENTIALS');
    const headers = wrapErrors(
      'INVALID_HEADERS',
      'invalid headers',
      () => HeaderMultiMap.from(httpHeaders),
      'headers',
    );
    if (
      !headers.has(Common.DATE) &&
      !headers.has(XiaomiHeader.DATE) &&
      getExpires(parseUri(uri).query) <= 0
    ) {
      throw new GalaxyFDSSignerError(
        'MISSING_DATE',
        `a "${Common.DATE}" or "${XiaomiHeader.DATE}" header is required to sign a request`,
        { field: 'headers' },
      );
    }
    const signature = await Signer.signToBase64(httpMethod, uri, headers, accessSecret, algorithm);
    return GALAXY_V2_PREFIX + accessKeyId + ':' + signature;
  },

  /**
   * Generates a pre-signed URI granting temporary access to a resource.
   *
   * @see {@link PresignUriInput} for the parameters.
   */
  async generatePresignedUri({
    baseUri,
    bucketName,
    objectName = '',
    subResources,
    ...options
  }: PresignUriInput): Promise<string> {
    requireString(bucketName, 'bucketName', 'INVALID_BUCKET');
    if (bucketName.includes('/')) {
      // A slash would silently shift the object into a different bucket path.
      throw new GalaxyFDSSignerError(
        'INVALID_BUCKET',
        `bucketName must not contain "/": ${bucketName}`,
        { field: 'bucketName' },
      );
    }
    const { accessId, expiresMillis } = validatePresignOptions(options);
    const subResourceParts = formatSubResources(subResources);
    const resourceUri = wrapErrors(
      'INVALID_ENDPOINT',
      'failed to generate pre-signed URI',
      () => buildResourceUri(baseUri, bucketName, objectName, subResourceParts),
      'baseUri',
    );
    return signPresignedUri(resourceUri, accessId, expiresMillis, options);
  },

  /**
   * Pre-signs an already-built resource URI (`…/{bucket}/{object}[?{sub-resources}]`,
   * e.g. from {@link buildResourceUri}) by appending `GalaxyAccessKeyId`,
   * `Expires` and `Signature`. Its query must hold only encoded sub-resources.
   */
  async presignResourceUri(resourceUri: string, options: PresignOptions): Promise<string> {
    const { accessId, expiresMillis } = validatePresignOptions(options);
    return signPresignedUri(resourceUri, accessId, expiresMillis, options);
  },
};

/** The signing parameters of a pre-signed URI; see {@link PresignUriInput}. */
export type PresignOptions = Omit<
  PresignUriInput,
  'baseUri' | 'bucketName' | 'objectName' | 'subResources'
>;

function validatePresignOptions(options: PresignOptions): {
  accessId: string;
  expiresMillis: number;
} {
  return {
    accessId: requireString(options.accessId, 'accessId', 'INVALID_CREDENTIALS'),
    expiresMillis: toExpiresMillis(options.expiration),
  };
}

async function signPresignedUri(
  resourceUri: string,
  accessId: string,
  expiresMillis: number,
  {
    method = HttpMethod.GET,
    accessSecret,
    algorithm = SignAlgorithm.HmacSHA1,
    headers,
  }: PresignOptions,
): Promise<string> {
  const separator = resourceUri.includes('?') ? '&' : '?';
  const encodedUri =
    resourceUri +
    `${separator}${Common.GALAXY_ACCESS_KEY_ID}=${accessId}&${Common.EXPIRES}=${expiresMillis}`;
  const signature = await Signer.signToBase64(method, encodedUri, headers, accessSecret, algorithm);
  return `${encodedUri}&${Common.SIGNATURE}=${urlEncode(signature)}`;
}

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
export function toExpiresMillis(expiration: Date | number, field = 'expiration'): number {
  const millis = expiration instanceof Date ? expiration.getTime() : expiration;
  if (typeof millis !== 'number' || !Number.isSafeInteger(millis)) {
    throw new GalaxyFDSSignerError(
      'INVALID_EXPIRATION',
      'expiration must be a valid Date or an integer epoch time in milliseconds',
      { field },
    );
  }
  if (millis < MIN_EXPIRES_MILLIS) {
    throw new GalaxyFDSSignerError(
      'INVALID_EXPIRATION',
      `expiration ${millis} is too small; it must be in milliseconds (not seconds) since the epoch`,
      { field },
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
