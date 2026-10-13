import { Common } from './common.js';
import { FDSClientConfiguration, type FDSClientConfigurationOptions } from './config.js';
import {
  type CredentialInput,
  type GalaxyFDSCredential,
  toGalaxyFDSCredential,
} from './credential.js';
import { HttpMethod, SignAlgorithm, SubResource } from './enums.js';
import { HeaderMultiMap, type HttpHeaders, Signer } from './auth/signer.js';

/**
 * Options for constructing a {@link GalaxyFDSClient}.
 *
 * Addressing options ({@link FDSClientConfigurationOptions}) are inherited from
 * {@link FDSClientConfiguration}; `signAlgorithm` is specific to this client.
 */
export interface FDSClientOptions extends FDSClientConfigurationOptions {
  /** Signature algorithm; defaults to {@link SignAlgorithm.HmacSHA1}. */
  signAlgorithm?: SignAlgorithm;
}

/**
 * Options for pre-signing, as an alternative to the positional parameters of
 * {@link GalaxyFDSClient.generatePresignedUri}.
 */
export interface PresignOptions {
  /** The HTTP method the pre-signed URI will be used with (defaults to GET). */
  method?: HttpMethod;
  /** Optional sub-resource fragments (e.g. `["acl"]`). */
  subResources?: Array<SubResource | string>;
  /** Optional content type included in the signature. */
  contentType?: string;
  /** Optional content-md5 included in the signature. */
  contentMD5?: string;
}

/**
 * A thin client exposing the authentication and pre-signed URI capabilities of
 * the Galaxy FDS Java SDK, keeping the same method shapes where practical.
 *
 * This client performs no network I/O; it only signs requests and builds
 * pre-signed URIs.
 */
export class GalaxyFDSClient {
  private readonly credential: GalaxyFDSCredential;
  private readonly config: FDSClientConfiguration;
  private readonly signAlgorithm: SignAlgorithm;

  /**
   * @param credential A {@link GalaxyFDSCredential} implementation or a plain
   *                   `{ accessId, accessSecret }` object.
   * @param options    Endpoint, addressing and algorithm overrides.
   */
  constructor(credential: CredentialInput, options: FDSClientOptions = {}) {
    this.credential = toGalaxyFDSCredential(credential);
    this.config = new FDSClientConfiguration(options);
    this.signAlgorithm = options.signAlgorithm ?? SignAlgorithm.HmacSHA1;
  }

  /** The resolved endpoint configuration. */
  getConfig(): FDSClientConfiguration {
    return this.config;
  }

  /**
   * Builds the `Authorization` header value for an arbitrary request.
   *
   * @param httpMethod  The HTTP method.
   * @param uri         The full request URI.
   * @param httpHeaders Headers participating in the signature (optional).
   */
  getAuthorizationHeader(httpMethod: HttpMethod, uri: string, httpHeaders?: HttpHeaders): string {
    return Signer.getAuthorizationHeader(
      httpMethod,
      uri,
      httpHeaders,
      this.credential.getGalaxyAccessId(),
      this.credential.getGalaxyAccessSecret(),
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
  generatePresignedUri(
    bucketName: string,
    objectName: string,
    expiration: Date | number,
    options?: PresignOptions,
  ): string;
  /**
   * Generates a pre-signed URI for the given object (positional form).
   *
   * @param bucketName   The bucket name.
   * @param objectName   The object name.
   * @param expiration   Expiration time (`Date` or epoch milliseconds).
   * @param httpMethod   The HTTP method (defaults to GET).
   * @param subResources Optional sub-resource fragments (e.g. `["acl"]`).
   * @param contentType  Optional content type included in the signature.
   * @param contentMD5   Optional content-md5 included in the signature.
   */
  generatePresignedUri(
    bucketName: string,
    objectName: string,
    expiration: Date | number,
    httpMethod?: HttpMethod,
    subResources?: Array<SubResource | string>,
    contentType?: string,
    contentMD5?: string,
  ): string;
  generatePresignedUri(
    bucketName: string,
    objectName: string,
    expiration: Date | number,
    optionsOrMethod: PresignOptions | HttpMethod = HttpMethod.GET,
    subResources?: Array<SubResource | string>,
    contentType?: string,
    contentMD5?: string,
  ): string {
    const resolved = resolvePresignOptions(optionsOrMethod, subResources, contentType, contentMD5);
    return this.presign(
      this.config.getBaseUri(),
      bucketName,
      objectName,
      expiration,
      resolved.method,
      resolved.subResources,
      resolved.contentType,
      resolved.contentMD5,
    );
  }

  /**
   * Generates a pre-signed CDN URI for the given object.
   *
   * @see {@link generatePresignedUri}
   */
  generatePresignedCdnUri(
    bucketName: string,
    objectName: string,
    expiration: Date | number,
    options?: PresignOptions,
  ): string;
  /**
   * Generates a pre-signed CDN URI for the given object (positional form).
   *
   * @see {@link generatePresignedUri}
   */
  generatePresignedCdnUri(
    bucketName: string,
    objectName: string,
    expiration: Date | number,
    httpMethod?: HttpMethod,
    subResources?: Array<SubResource | string>,
    contentType?: string,
    contentMD5?: string,
  ): string;
  generatePresignedCdnUri(
    bucketName: string,
    objectName: string,
    expiration: Date | number,
    optionsOrMethod: PresignOptions | HttpMethod = HttpMethod.GET,
    subResources?: Array<SubResource | string>,
    contentType?: string,
    contentMD5?: string,
  ): string {
    const resolved = resolvePresignOptions(optionsOrMethod, subResources, contentType, contentMD5);
    return this.presign(
      this.config.getCdnBaseUri(),
      bucketName,
      objectName,
      expiration,
      resolved.method,
      resolved.subResources,
      resolved.contentType,
      resolved.contentMD5,
    );
  }

  private presign(
    baseUri: string,
    bucketName: string,
    objectName: string,
    expiration: Date | number,
    httpMethod: HttpMethod,
    subResources: Array<SubResource | string>,
    contentType?: string,
    contentMD5?: string,
  ): string {
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

    const subResourceNames = subResources.map((s) => s.toString());

    return Signer.generatePresignedUri(
      this.applyVirtualAddressing(baseUri, bucketName),
      bucketName,
      objectName,
      subResourceNames,
      expiration,
      httpMethod,
      this.credential.getGalaxyAccessId(),
      this.credential.getGalaxyAccessSecret(),
      this.signAlgorithm,
      headers,
    );
  }

  /**
   * Rewrites the host of `baseUri` to virtual-hosted style
   * (`{bucket}.{endpoint}`) when the configured endpoint uses `*.mi-fds.com`
   * addressing. Mirrors the Java SDK's `GalaxyFDSClient.generatePresignedUri`,
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
    return `${url.protocol}//${bucketName}.${url.host}/`;
  }
}

/** Fully-resolved pre-sign parameters, ready for the private presign helper. */
interface ResolvedPresignOptions {
  method: HttpMethod;
  subResources: Array<SubResource | string>;
  contentType?: string;
  contentMD5?: string;
}

/**
 * Merges the two public call shapes (options object vs. positional
 * parameters) into one normalized structure.
 */
function resolvePresignOptions(
  optionsOrMethod: PresignOptions | HttpMethod,
  subResources?: Array<SubResource | string>,
  contentType?: string,
  contentMD5?: string,
): ResolvedPresignOptions {
  if (typeof optionsOrMethod === 'object') {
    return {
      method: optionsOrMethod.method ?? HttpMethod.GET,
      subResources: optionsOrMethod.subResources ?? [],
      contentType: optionsOrMethod.contentType,
      contentMD5: optionsOrMethod.contentMD5,
    };
  }
  return {
    method: optionsOrMethod ?? HttpMethod.GET,
    subResources: subResources ?? [],
    contentType,
    contentMD5,
  };
}
