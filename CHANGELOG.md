# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release: Galaxy-V2 request signing and pre-signed URI generation,
  ported from `galaxy-fds-sdk-java` 3.0.48.
- `GalaxyFDSClient` high-level client and `Signer` low-level primitives.
- Plain-object credentials: pass `{ accessId, accessSecret }` directly or any
  `GalaxyFDSCredential` implementation (e.g. `BasicFDSCredential`).
- `PresignOptions`, an options-object form of `generatePresignedUri` /
  `generatePresignedCdnUri`; the positional parameter form remains supported.
- `HttpMethod` / `SignAlgorithm` / `SubResource` / `XiaomiHeader` constant maps
  with literal union types, plus signing utilities.
- Golden parity test suite generated from the official Java SDK.
- `FDSClientConfiguration` (exported) and the `endpoint` / `regionName` /
  `cdnEndpoint` / `enableHttps` / `enableCdnForUpload` / `enableCdnForDownload`
  options on `GalaxyFDSClient`, ported from the Java SDK's
  `FDSClientConfiguration`.

### Changed

- `HeaderMultiMap` lookups are now case-sensitive, matching the Java SDK's
  Guava `LinkedListMultimap`. Previously they ignored case, so headers such as
  `Date` or `Content-Type` were signed even though the Java SDK only signs the
  lower-cased forms. Pass headers with the exact keys the service expects
  (e.g. `date`, `content-type`, `x-xiaomi-date`).
