import { GalaxyFDSSignerError } from './errors.js';

/**
 * HTTP request methods supported by Galaxy FDS.
 *
 * Ported from `com.xiaomi.infra.galaxy.fds.model.HttpMethod`.
 */
export const HttpMethod = {
  GET: 'GET',
  HEAD: 'HEAD',
  PUT: 'PUT',
  POST: 'POST',
  DELETE: 'DELETE',
} as const;

/** Any HTTP method supported by Galaxy FDS. Plain strings like `'GET'` are assignable. */
export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod];

/**
 * Signature algorithms supported by the Galaxy REST server.
 *
 * The values match the Node.js `crypto` HMAC algorithm names (case-insensitive),
 * mirroring the Java SDK's `javax.crypto.Mac` standard names.
 *
 * Ported from `com.xiaomi.infra.galaxy.fds.auth.signature.SignAlgorithm`.
 */
export const SignAlgorithm = {
  HmacMD5: 'HmacMD5',
  HmacSHA1: 'HmacSHA1',
  HmacSHA256: 'HmacSHA256',
} as const;

/** Any signature algorithm supported by the Galaxy REST server. */
export type SignAlgorithm = (typeof SignAlgorithm)[keyof typeof SignAlgorithm];

/**
 * Maps a {@link SignAlgorithm} to the digest name expected by Node.js `crypto.createHmac`.
 */
export const SIGN_ALGORITHM_DIGEST: Record<SignAlgorithm, string> = {
  [SignAlgorithm.HmacMD5]: 'md5',
  [SignAlgorithm.HmacSHA1]: 'sha1',
  [SignAlgorithm.HmacSHA256]: 'sha256',
};

/**
 * The subset of S3-style sub-resources recognized by Galaxy FDS. Only these
 * query parameters participate in the canonicalized resource of a signature.
 *
 * Ported from `com.xiaomi.infra.galaxy.fds.SubResource`.
 */
export const SubResource = {
  ACL: 'acl',
  QUOTA: 'quota',
  UPLOADS: 'uploads',
  PART_NUMBER: 'partNumber',
  UPLOAD_ID: 'uploadId',
  STORAGE_ACCESS_TOKEN: 'storageAccessToken',
  COMPRESSION: 'compression',
  METADATA: 'metadata',
} as const;

/** Any sub-resource name recognized by Galaxy FDS. */
export type SubResource = (typeof SubResource)[keyof typeof SubResource];

/** The set of all sub-resource names, used while canonicalizing the resource. */
export const SUB_RESOURCE_SET: ReadonlySet<string> = new Set(Object.values(SubResource));

/**
 * Xiaomi-defined HTTP headers.
 *
 * Ported from `com.xiaomi.infra.galaxy.fds.auth.signature.XiaomiHeader`.
 */
export const XiaomiHeader = {
  DATE: 'x-xiaomi-date',
  REQUEST_ID: 'x-xiaomi-request-id',
  ACL: 'x-xiaomi-acl',
  ACL_META: 'x-xiaomi-meta-acl',
  CONTENT_LENGTH: 'x-xiaomi-meta-content-length',
  MD5_ATTACHED_STREAM: 'x-xiaomi-meta-md5-attached-stream',
} as const;

/** Any Xiaomi-defined HTTP header name. */
export type XiaomiHeader = (typeof XiaomiHeader)[keyof typeof XiaomiHeader];

const HTTP_METHOD_SET: ReadonlySet<string> = new Set(Object.values(HttpMethod));

/**
 * Normalizes an HTTP method to upper case (as `fetch` does) and checks that
 * Galaxy FDS supports it.
 *
 * @throws GalaxyFDSSignerError for unsupported or non-string methods.
 */
export function toHttpMethod(method: unknown): HttpMethod {
  const upper = typeof method === 'string' ? method.toUpperCase() : undefined;
  if (upper === undefined || !HTTP_METHOD_SET.has(upper)) {
    throw new GalaxyFDSSignerError(
      `unsupported HTTP method: ${String(method)} (expected one of ${[...HTTP_METHOD_SET].join(', ')})`,
    );
  }
  return upper as HttpMethod;
}

/**
 * Checks that `algorithm` is a supported {@link SignAlgorithm}.
 *
 * @throws GalaxyFDSSignerError for unknown algorithms.
 */
export function toSignAlgorithm(algorithm: unknown): SignAlgorithm {
  if (typeof algorithm !== 'string' || !Object.hasOwn(SIGN_ALGORITHM_DIGEST, algorithm)) {
    throw new GalaxyFDSSignerError(
      `unsupported sign algorithm: ${String(algorithm)} (expected one of ${Object.keys(SIGN_ALGORITHM_DIGEST).join(', ')})`,
    );
  }
  return algorithm as SignAlgorithm;
}
