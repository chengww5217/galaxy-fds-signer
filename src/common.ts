/**
 * Shared constants used during authentication and pre-signed URI generation.
 *
 * Ported from `com.xiaomi.infra.galaxy.fds.Common`. Only the subset relevant to
 * signing and pre-signed URIs is included.
 */
export const Common = {
  /** Prefix of all Xiaomi-defined headers; only these are canonicalized. */
  XIAOMI_HEADER_PREFIX: 'x-xiaomi-',

  // Required query parameters for a pre-signed URI.
  GALAXY_ACCESS_KEY_ID: 'GalaxyAccessKeyId',
  SIGNATURE: 'Signature',
  EXPIRES: 'Expires',

  // HTTP headers used for authentication.
  CONTENT_MD5: 'content-md5',
  CONTENT_TYPE: 'content-type',
  DATE: 'date',

  /** Default base URI of the FDS service. */
  DEFAULT_FDS_SERVICE_BASE_URI: 'http://files.fds.api.xiaomi.com/',

  /** Default base URI of the CDN service. */
  DEFAULT_CDN_SERVICE_URI: 'http://cdn.fds.api.xiaomi.com/',
} as const;

/** `multipart/form-data` content type, special-cased when building the string to sign. */
export const MULTIPART_FORM_DATA = 'multipart/form-data';

/** Authorization header scheme prefix produced by the signer. */
export const GALAXY_V2_PREFIX = 'Galaxy-V2 ';
