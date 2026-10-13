import { Common } from './common.js';
import { GalaxyFDSSignerError } from './errors.js';

/**
 * Endpoint configuration for a {@link GalaxyFDSSigner}.
 *
 * Ported from the URI-relevant subset of the Java SDK's
 * `com.xiaomi.infra.galaxy.fds.client.FDSClientConfiguration`. Only the
 * addressing-related options are implemented here; the Node library performs no
 * network I/O, so timeouts, retries, connection pools and the like are out of
 * scope.
 */
export interface FDSEndpointOptions {
  /**
   * Service endpoint host, e.g. `files.fds.api.xiaomi.com` or `files.mi-fds.com`
   * (a port may be appended). The region name and the addressing style are
   * derived from its suffix.
   */
  endpoint?: string;
  /**
   * Region name. Only used when {@link endpoint} is omitted, in which case the
   * endpoint `{regionName}.fds.api.xiaomi.com` is assumed; otherwise the region
   * is derived from the endpoint.
   */
  regionName?: string;
  /** CDN endpoint host; defaults to the endpoint-derived CDN host. */
  cdnEndpoint?: string;
  /** Whether to use HTTPS. Forced on for virtual-hosted (`*.mi-fds.com`) endpoints. */
  enableHttps?: boolean;
  /** Explicit service base URI, taking precedence over {@link endpoint}. */
  baseUri?: string;
  /** Explicit CDN base URI, taking precedence over {@link cdnEndpoint}. */
  cdnBaseUri?: string;
}

const URI_HTTP_PREFIX = 'http://';
const URI_HTTPS_PREFIX = 'https://';
const URI_CDN = 'cdn';
// The internal (private network) endpoint format: {region}-fds.api.xiaomi.net
const URI_NET_SUFFIX = '-fds.api.xiaomi.net';
// The public endpoint format: {region}.fds.api.xiaomi.com
const URI_COM_SUFFIX = '.fds.api.xiaomi.com';
// The virtual-hosted (bucket-as-subdomain) endpoint format: {region}.mi-fds.com
const URI_HOST_STYLE_COM_SUFFIX = '.mi-fds.com';
// The CDN endpoint format: cdn.{region}.fds.api.mi-img.com
const URI_CDN_SUFFIX = '.fds.api.mi-img.com';

/**
 * Resolves the base URIs and addressing style used by {@link GalaxyFDSSigner}.
 *
 * @see FDSEndpointOptions
 */
export class FDSEndpointConfiguration {
  /** The configured service endpoint host, or `undefined` when only a base URI was given. */
  readonly endpoint: string | undefined;
  /** The derived (or supplied) region name, or `undefined` when not derivable. */
  readonly regionName: string | undefined;
  /** The resolved CDN endpoint host, or `undefined` when none applies. */
  readonly cdnEndpoint: string | undefined;

  private readonly uriSuffix: string | undefined;
  private readonly enableHttps: boolean;
  private readonly explicitBaseUri: string | undefined;
  private readonly explicitCdnBaseUri: string | undefined;

  constructor(options: FDSEndpointOptions = {}) {
    let endpoint = options.endpoint;
    if (endpoint === undefined && options.regionName !== undefined) {
      endpoint = options.regionName + URI_COM_SUFFIX;
    }

    let uriSuffix: string | undefined;
    let regionName = options.regionName;

    if (endpoint !== undefined) {
      if (endpoint.length === 0) {
        throw new GalaxyFDSSignerError('endpoint must be a non-empty string');
      }
      const host = endpoint.split(':')[0];
      if (host.endsWith(URI_NET_SUFFIX)) {
        uriSuffix = URI_NET_SUFFIX;
      } else if (host.endsWith(URI_COM_SUFFIX)) {
        uriSuffix = URI_COM_SUFFIX;
      } else if (host.endsWith(URI_HOST_STYLE_COM_SUFFIX)) {
        uriSuffix = URI_HOST_STYLE_COM_SUFFIX;
      } else {
        throw new GalaxyFDSSignerError('illegal endpoint: ' + endpoint);
      }
      regionName = host.substring(0, host.length - uriSuffix.length);
    }

    this.endpoint = endpoint;
    this.uriSuffix = uriSuffix;
    this.regionName = regionName;

    const virtual = this.shouldUseVirtualAddressing();
    // The Java SDK forces HTTPS on virtual-hosted endpoints, and defaults to
    // HTTPS whenever an endpoint is configured.
    this.enableHttps = virtual ? true : (options.enableHttps ?? endpoint !== undefined);

    if (options.cdnEndpoint !== undefined) {
      this.cdnEndpoint = options.cdnEndpoint;
    } else if (endpoint !== undefined && !virtual) {
      this.cdnEndpoint = URI_CDN + '.' + regionName + URI_CDN_SUFFIX;
    } else {
      this.cdnEndpoint = undefined;
    }

    this.explicitBaseUri = options.baseUri;
    this.explicitCdnBaseUri = options.cdnBaseUri;
  }

  /**
   * Whether the endpoint uses virtual-hosted-style addressing, i.e. the bucket
   * is encoded as a subdomain (`{bucket}.{region}.mi-fds.com`).
   */
  shouldUseVirtualAddressing(): boolean {
    return this.uriSuffix === URI_HOST_STYLE_COM_SUFFIX;
  }

  isHttpsEnabled(): boolean {
    return this.enableHttps;
  }

  /** The service base URI used for signing and pre-signed URIs. */
  getBaseUri(): string {
    return this.explicitBaseUri ?? this.buildBaseUri(false);
  }

  /** The CDN base URI used for CDN pre-signed URIs. */
  getCdnBaseUri(): string {
    return this.explicitCdnBaseUri ?? this.buildBaseUri(true);
  }

  private buildBaseUri(enableCdn: boolean): string {
    if (this.endpoint === undefined) {
      // No endpoint configured: fall back to the built-in default URIs.
      return enableCdn ? Common.DEFAULT_CDN_SERVICE_URI : Common.DEFAULT_FDS_SERVICE_BASE_URI;
    }

    const host = enableCdn ? this.cdnEndpoint : this.endpoint;
    if (host === undefined || host.length === 0) {
      throw new GalaxyFDSSignerError(
        'Please use cdnEndpoint (or cdnBaseUri) to set the CDN domain first if you want to use the CDN.',
      );
    }
    return (this.enableHttps ? URI_HTTPS_PREFIX : URI_HTTP_PREFIX) + host + '/';
  }
}
