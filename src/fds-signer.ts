import { Common } from './common.js';
import { FDSEndpointConfiguration, type FDSEndpointOptions } from './config.js';
import {
  type CredentialInput,
  type GalaxyFDSCredential,
  toGalaxyFDSCredential,
} from './credential.js';
import { HttpMethod, SignAlgorithm } from './enums.js';
import { GalaxyFDSSignerError } from './errors.js';
import {
  HeaderMultiMap,
  type HttpHeaders,
  Signer,
  type SubResources,
  toExpiresMillis,
} from './auth/signer.js';

/**
 * Options for constructing a {@link GalaxyFDSSigner}.
 *
 * Addressing options ({@link FDSEndpointOptions}) are inherited from
 * {@link FDSEndpointConfiguration}; `signAlgorithm` is specific to this signer.
 */
export interface GalaxyFDSSignerOptions extends FDSEndpointOptions {
  /** Signature algorithm; defaults to {@link SignAlgorithm.HmacSHA1}. */
  signAlgorithm?: SignAlgorithm;
}

/** A single DNS label: what a bucket must be to serve as a subdomain. */
const DNS_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** Options for {@link GalaxyFDSSigner.generatePresignedUri}. */
export interface PresignOptions {
  /** The HTTP method the pre-signed URI will be used with (defaults to GET). */
  method?: HttpMethod;
  /** Sub-resources, e.g. `['acl']` or `{ uploadId: 'abc', partNumber: 1 }`. */
  subResources?: SubResources;
  /** Optional content type included in the signature. */
  contentType?: string;
  /** Optional content-md5 included in the signature. */
  contentMD5?: string;
}

/**
 * A signer exposing the authentication and pre-signed URI capabilities of
 * the Galaxy FDS Java SDK, keeping the same method shapes where practical.
 *
 * This class performs no network I/O; it only signs requests and builds
 * pre-signed URIs.
 */
export class GalaxyFDSSigner {
  // #private so the credential never shows up when the signer is logged.
  readonly #credential: GalaxyFDSCredential;
  private readonly config: FDSEndpointConfiguration;
  private readonly signAlgorithm: SignAlgorithm;

  /**
   * @param credential A {@link GalaxyFDSCredential} implementation or a plain
   *                   `{ accessId, accessSecret }` object.
   * @param options    Endpoint, addressing and algorithm overrides.
   */
  constructor(credential: CredentialInput, options: GalaxyFDSSignerOptions = {}) {
    this.#credential = toGalaxyFDSCredential(credential);
    this.config = new FDSEndpointConfiguration(options);
    this.signAlgorithm = options.signAlgorithm ?? SignAlgorithm.HmacSHA1;
  }

  /** The resolved endpoint configuration. */
  getConfig(): FDSEndpointConfiguration {
    return this.config;
  }

  /**
   * Builds the `Authorization` header value for an arbitrary request.
   *
   * @param httpMethod  The HTTP method.
   * @param uri         The full request URI.
   * @param httpHeaders Headers participating in the signature (optional).
   */
  async getAuthorizationHeader(
    httpMethod: HttpMethod,
    uri: string,
    httpHeaders?: HttpHeaders,
  ): Promise<string> {
    return Signer.getAuthorizationHeader(
      httpMethod,
      uri,
      httpHeaders,
      this.#credential.getGalaxyAccessId(),
      this.#credential.getGalaxyAccessSecret(),
      this.signAlgorithm,
    );
  }

  /**
   * Generates a pre-signed URI for the given object.
   *
   * @param bucketName The bucket name.
   * @param objectName The object name.
   * @param expiration Expiration time (`Date` or epoch milliseconds).
   * @param options    Method, sub-resources and signed headers.
   */
  async generatePresignedUri(
    bucketName: string,
    objectName: string,
    expiration: Date | number,
    options: PresignOptions = {},
  ): Promise<string> {
    return this.presign(this.config.getBaseUri(), bucketName, objectName, expiration, options);
  }

  /**
   * Generates a pre-signed CDN URI for the given object.
   *
   * @see {@link generatePresignedUri}
   */
  async generatePresignedCdnUri(
    bucketName: string,
    objectName: string,
    expiration: Date | number,
    options: PresignOptions = {},
  ): Promise<string> {
    return this.presign(this.config.getCdnBaseUri(), bucketName, objectName, expiration, options);
  }

  private presign(
    baseUri: string,
    bucketName: string,
    objectName: string,
    expiration: Date | number,
    { method = HttpMethod.GET, subResources, contentType, contentMD5 }: PresignOptions,
  ): Promise<string> {
    if (toExpiresMillis(expiration) <= Date.now()) {
      throw new GalaxyFDSSignerError('expiration must be in the future');
    }

    let headers: HeaderMultiMap | undefined;
    if (contentType !== undefined || contentMD5 !== undefined) {
      headers = new HeaderMultiMap();
      if (contentType !== undefined) {
        headers.put(Common.CONTENT_TYPE, contentType);
      }
      if (contentMD5 !== undefined) {
        headers.put(Common.CONTENT_MD5, contentMD5);
      }
    }

    return Signer.generatePresignedUri({
      baseUri: this.applyVirtualAddressing(baseUri, bucketName),
      bucketName,
      objectName,
      subResources,
      expiration,
      method,
      accessId: this.#credential.getGalaxyAccessId(),
      accessSecret: this.#credential.getGalaxyAccessSecret(),
      algorithm: this.signAlgorithm,
      headers,
    });
  }

  /**
   * Rewrites the host of `baseUri` to virtual-hosted style
   * (`{bucket}.{endpoint}`) when the configured endpoint uses `*.mi-fds.com`
   * addressing. Mirrors the Java SDK's `GalaxyFDSSigner.generatePresignedUri`,
   * which keeps the bucket in the path but moves it into the subdomain. The
   * host is not part of the string to sign, so the signature is unaffected.
   */
  private applyVirtualAddressing(baseUri: string, bucketName: string): string {
    const endpoint = this.config.endpoint;
    if (
      !this.config.shouldUseVirtualAddressing() ||
      endpoint === undefined ||
      bucketName.length === 0
    ) {
      return baseUri;
    }

    const url = new URL(baseUri);
    if (url.hostname !== endpoint.split(':')[0].toLowerCase()) {
      return baseUri;
    }
    if (!DNS_LABEL.test(bucketName)) {
      // The bucket becomes a subdomain: anything but a single DNS label
      // (e.g. "a.b", "x@evil.com", "a/b") would change the target host.
      throw new GalaxyFDSSignerError(
        `bucketName ${JSON.stringify(bucketName)} cannot be used with virtual-hosted addressing: ` +
          'it must be a DNS label (letters, digits and inner hyphens, at most 63 characters)',
      );
    }
    return `${url.protocol}//${bucketName}.${url.host}/`;
  }
}
