/**
 * Galaxy FDS signer.
 *
 * Galaxy-V2 request signing and pre-signed URLs for Xiaomi Galaxy FDS, ported
 * from the official `galaxy-fds-sdk-java`. Built on Web-standard APIs only, so
 * it runs on Node.js, Cloudflare Workers, Vercel Edge, Deno and Bun.
 *
 * ```ts
 * import { createSigner } from 'galaxy-fds-signer';
 *
 * const signer = createSigner({
 *   accessId,
 *   accessSecret,
 *   endpoint: 'cnbj1.fds.api.xiaomi.com',
 *   bucket: 'b',
 * });
 * // `bucket` is optional on the request; pass one to override the configured default.
 * const req = await signer.signRequest({ method: 'PUT', object: 'a.png' });
 * await fetch(req.url, { ...req, body });
 * ```
 */

export {
  createSigner,
  signRequest,
  presign,
  type FdsSigner,
  type SignerOptions,
  type SignRequestInput,
  type PresignInput,
  type ResourceTarget,
  type UrlTarget,
  type RequestHeaders,
  type SignedRequest,
  type PresignedRequest,
} from './api.js';
export type { FDSEndpointOptions } from './config.js';
export type { SubResources } from './auth/signer.js';
export { HttpMethod, SignAlgorithm, SubResource, XiaomiHeader } from './enums.js';
export {
  ErrorCode,
  GalaxyFDSSignerError,
  type GalaxyFDSSignerErrorCode,
  type GalaxyFDSSignerErrorJSON,
  type GalaxyFDSSignerErrorKind,
} from './errors.js';
