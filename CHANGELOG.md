# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release: Galaxy-V2 request signing and pre-signed URI generation,
  ported from `galaxy-fds-sdk-java` 3.0.48.
- `GalaxyFDSClient` high-level client and `Signer` low-level primitives.
- `BasicFDSCredential`, the `HttpMethod` / `SignAlgorithm` / `SubResource` /
  `XiaomiHeader` enums, and signing utilities.
- Golden parity test suite generated from the official Java SDK.
