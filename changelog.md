# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.4.1]

### Changes
- Improved indentation handling in code generation
- Centralized indentation logic in `JsonContext` class
- Removed redundant indentation methods from `JsonType` class
- Fixed indentation in selection and type writing

## [0.4.0]

### Changes
- Refactored `writer` and cleaned up for better maintainability

## [0.3.2]

### Changes
- Made options public for better accessibility
- Passed options to context for improved configuration handling

## [0.3.1]

### Changes
- minor change to add two options to `OasGen`: 
  1. `consolidateUnions`: consolidate all `OneOf` types into a single GraphQL `type`. This is a work-around until the Connectors spec supports `union`s.
  2. `showParentInSelections`: adds a comment in each field of the selection section to identify where the field is being pulled from. Useful for debugging purposes only.


## [0.3.0] Removed `Ref` node (breaking)

### Changes
- **Breaking change**: not using `Ref` anymore - expanding a type that has a `ref` will go directly into the type. This affects all generated `paths` and a type's `path()`. Tests have been rebuilt to reflect this change
- *Breaking*: renamed `anonymous` for `inline` to better reflect the nature of the object
- Two modes are supported for `Union`s: generated either a single object (the default behaviour as Connectors does not support `unions` yet) or to generate `union`s will which yield a more correct (yet unsupported) schema. If a Union is _consolidated_ in a single type, all references (and any container child node) will be removed so it's not generated in the schema 
- Proper _circular ref_ checks; now also work for `props`. Even in the case when a selection includes a circular ref, it should still work properly and the node should be ignored

### Fixes
- All tests and more. Better support for `mutations` (`POST`, `PUT`, etc.)

### Pending
- Unions should use `->match` and the `discriminator` in the `selection` bit, instead of selecting all fields.

## [0.2.1]

### Fixed
- Fixed unions: now we don't overwrite the fields when we consolidate them, but rather add a new one. This is because `union` is not yet supported by the Connector spec. 

### Pending

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