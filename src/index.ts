/**
 * Galaxy FDS signer.
 *
 * Provides Galaxy-V2 request signing and pre-signed URI generation, ported from
 * the official Xiaomi `galaxy-fds-sdk-java`.
 */

export { HttpMethod, SignAlgorithm, SubResource, XiaomiHeader } from './enums.js';
export { GalaxyFDSSignerError } from './errors.js';
export {
  type GalaxyFDSCredential,
  type CredentialObject,
  type CredentialInput,
  BasicFDSCredential,
} from './credential.js';
export { Signer, type HttpHeaders, constructStringToSign } from './auth/signer.js';
export { urlEncode } from './auth/utils.js';
export { GalaxyFDSSigner, type GalaxyFDSSignerOptions, type PresignOptions } from './fds-signer.js';
export { FDSEndpointConfiguration, type FDSEndpointOptions } from './config.js';
