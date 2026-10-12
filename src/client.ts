import { Common } from './common.js';
import { type CredentialInput, type GalaxyFDSCredential, toGalaxyFDSCredential } from './credential.js';
import { HttpMethod, SignAlgorithm, SubResource } from './enums.js';
import { HeaderMultiMap, type HttpHeaders, Signer } from './auth/signer.js';

/** Options for constructing a {@link GalaxyFDSClient}. */
export interface FDSClientOptions {
  /**
   * Service base URI used for pre-signed URIs, e.g. `http://files.fds.api.xiaomi.com/`.
   * Defaults to {@link Common.DEFAULT_FDS_SERVICE_BASE_URI}.
   */
  baseUri?: string;
  /**
   * CDN base URI used for pre-signed CDN URIs, e.g. `http://cdn.fds.api.xiaomi.com/`.
   * Defaults to {@link Common.DEFAULT_CDN_SERVICE_URI}.
   */
  cdnBaseUri?: string;
  /** Signature algorithm; defaults to {@link SignAlgorithm.HmacSHA1}. */
  signAlgorithm?: SignAlgorithm;
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
  private readonly baseUri: string;
  private readonly cdnBaseUri: string;
  private readonly signAlgorithm: SignAlgorithm;

  /**
   * @param credential A {@link GalaxyFDSCredential} implementation or a plain
   *                   `{ accessId, accessSecret }` object.
   * @param options    Endpoint and algorithm overrides.
   */
  constructor(credential: CredentialInput, options: FDSClientOptions = {}) {
    this.credential = toGalaxyFDSCredential(credential);
    this.baseUri = options.baseUri ?? Common.DEFAULT_FDS_SERVICE_BASE_URI;
    this.cdnBaseUri = options.cdnBaseUri ?? Common.DEFAULT_CDN_SERVICE_URI;
    this.signAlgorithm = options.signAlgorithm ?? SignAlgorithm.HmacSHA1;
  }

  /**
   * Builds the `Authorization` header value for an arbitrary request.
   *
   * @param httpMethod  The HTTP method.
   * @param uri         The full request URI.
   * @param httpHeaders Headers participating in the signature (optional).
   */
  getAuthorizationHeader(
    httpMethod: HttpMethod,
    uri: string,
    httpHeaders?: HttpHeaders,
  ): string {
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
    httpMethod: HttpMethod = HttpMethod.GET,
    subResources: Array<SubResource | string> | null = null,
    contentType?: string,
    contentMD5?: string,
  ): string {
    return this.presign(
      this.baseUri,
      bucketName,
      objectName,
      expiration,
      httpMethod,
      subResources,
      contentType,
      contentMD5,
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
    httpMethod: HttpMethod = HttpMethod.GET,
    subResources: Array<SubResource | string> | null = null,
    contentType?: string,
    contentMD5?: string,
  ): string {
    return this.presign(
      this.cdnBaseUri,
      bucketName,
      objectName,
      expiration,
      httpMethod,
      subResources,
      contentType,
      contentMD5,
    );
  }

  private presign(
    baseUri: string,
    bucketName: string,
    objectName: string,
    expiration: Date | number,
    httpMethod: HttpMethod,
    subResources: Array<SubResource | string> | null,
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

    const subResourceNames =
      subResources == null ? null : subResources.map((s) => s.toString());

    return Signer.generatePresignedUri(
      baseUri,
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
}
