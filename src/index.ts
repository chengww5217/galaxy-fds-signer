/**
 * Galaxy FDS Node.js signer.
 *
 * Provides Galaxy-V2 request signing and pre-signed URI generation, ported from
 * the official Xiaomi `galaxy-fds-sdk-java`.
 */

export { Common, GALAXY_V2_PREFIX, MULTIPART_FORM_DATA } from './common.js';
export {
  HttpMethod,
  SignAlgorithm,
  SubResource,
  XiaomiHeader,
  SIGN_ALGORITHM_DIGEST,
  SUB_RESOURCE_SET,
} from './enums.js';
export { GalaxyFDSClientException } from './errors.js';
export {
  type GalaxyFDSCredential,
  type CredentialObject,
  type CredentialInput,
  BasicFDSCredential,
  toGalaxyFDSCredential,
} from './credential.js';
export {
  Signer,
  type HttpHeaders,
  constructStringToSign,
  canonicalizeXiaomiHeaders,
  canonicalizeResource,
} from './auth/signer.js';
export {
  parseUri,
  type UriParts,
  parseUriParameters,
  getGMTDatetime,
  urlEncode,
  encodeUriPath,
  calcMD5,
} from './auth/utils.js';
export { GalaxyFDSClient, type FDSClientOptions, type PresignOptions } from './client.js';
export { FDSClientConfiguration, type FDSClientConfigurationOptions } from './config.js';
