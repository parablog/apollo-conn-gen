# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.2.1]

### Fixed
- Fixed unions: now we don't overwrite the fields when we consolidate them, but rather add a new one. This is because `union` is not yet supported by the Connector spec. 

### Pending
- Unions should use `->match` and the `discriminator` in the `selection` bit, instead of selecting all fields. 

## [0.1.3]

### Fixed
- Fixed `DELETE` paths with `boolean` responses. Note that these mostly return `application/json` media, which might require additional work in the resulting schema to work properly.

## [0.1.1]

### Added
- Support for `PUT`, `PATCH` and `DELETE` requests

## [0.0.13]

### Added
- Initial support for `POST` requests

### Changed
- **BREAKING CHANGE**:  the internal format for a `path` now contains the type, either `type` or `input`. This is needed to generate the correct `GraphQL` type and for the body selection in `POST` operations. To fix this, replace the following in your selection `JSON` payloads:
  - `>obj:` => `>obj:type:` - i.e.: `post:/user>res:r>obj:type:userResponse>prop:scalar:success`
  - `>comp:` => `>comp:type:`
  - `>union:` => `>union:type:` 

### Deprecated
- None

### Fixed
- Empty responses from GET now return a default `Response` GraphQL type with a `success: Boolean` field mapped to `$(true)` in the selection. Consumers can ignore this value. 

### Security
- N/A

## [0.0.12] - 2025-03-19

### Added
- First version, supports `GET` requests only.