import type { IType } from '../nodes/internal.js';
import { Naming } from './naming.js';

// The reason strings a field carries when it gives up on a clean GraphQL type and falls back to JSON. #201
export class JsonDegradeReasons {
  static danglingRef(ref: string): string {
    return `the reference '${ref}' doesn't point to anything in this API description — sent as raw JSON instead.`;
  }

  static shapelessObject(): string {
    return 'this object declares no properties of its own — sent as raw JSON instead.';
  }

  static noScalarEquivalent(typeStr: string): string {
    return `this schema's type '${typeStr}' has no GraphQL scalar equivalent — sent as raw JSON instead.`;
  }

  static scalarOnlyOneOf(): string {
    return 'a oneOf of only plain scalar/enum values has no GraphQL union member to build — sent as raw JSON instead.';
  }

  static mapAsInput(): string {
    return "a map (object with arbitrary keys) can't be an input type in GraphQL — sent as raw JSON instead of a typed structure.";
  }

  // e.g. (ashby) a mixed oneOf reused as a request body: [boolean, { currencyCode, value }, string]
  static mixedInputChoice(): string {
    return 'a oneOf mixing object and plain members in a request body is sent as raw JSON: rebuilding it as a typed input is not implemented yet.';
  }

  static unknownShape(): string {
    return "this field's shape didn't match any known pattern and defaulted to JSON — worth checking the source OAS schema.";
  }

  static emptyResponseBody(statusCode: string): string {
    return `the '${statusCode}' response declares no body — the real API may still return data this spec doesn't describe, so it's read as raw JSON instead of a fabricated empty result.`;
  }

  // e.g. (jira-platform) get:/rest/api/3/screens/tabs 200: { content: { application/json: { example: ... } } }
  // — an `example` with no `schema` #239
  static responseWithoutSchema(statusCode: string): string {
    return `the '${statusCode}' response declares a body but no schema for it — read as raw JSON instead.`;
  }

  // moved from T.everyFieldRemovedReason. see docs/FIXED.md #101
  static everyFieldRemoved(type: IType): string {
    return `every field of ${Naming.getRefName(type.name)} was removed to break a reference cycle, leaving no type to write — sent as raw JSON instead.`;
  }

  static incompatibleMergedField(): string {
    return 'different branches of a merged type declare this field differently, and no single GraphQL type fits both — sent as raw JSON.';
  }

  static emptyMerge(): string {
    return "this union merges every member's fields into one type, but none were selected — sent as raw JSON instead.";
  }

  static mapValuesPlainChoice(): string {
    return "a map's values are a choice of nothing but plain scalar or enum values, or an object with no properties, with no GraphQL union member to build — sent as raw JSON instead.";
  }

  static mapValuesNoFields(): string {
    return "this map's values declare no fields of their own — sent as raw JSON instead.";
  }

  static mapValuesAnyJson(): string {
    return "this map's values are declared as `additionalProperties: {}` — the API explicitly allows any JSON value here, so there's no fixed shape to model as a GraphQL type.";
  }

  // Explains why an object-only anyOf keeps JSON until required markers can be merged safely.
  // e.g. anyOf: [$ref A { code required }, $ref B { code optional }]
  static objectOnlyAnyOf(): string {
    return 'an anyOf of only objects is sent as raw JSON: merging their fields keeps a required marker some member does not have, see docs/TASKS.md #212';
  }

  // Explains why an incompatible member prevents a mixed anyOf from producing a typed value.
  // e.g. anyOf: [integer(int64), object required {code}, object optional {code}]
  static unbuildableMixedAnyOf(): string {
    return "a mixed anyOf here can't build a mixed-value type — an incompatible member, such as an integer too wide for Int, blocks it — sent as raw JSON instead, see docs/TASKS.md #212";
  }

  // a JSON Schema tuple (`prefixItems`, no `items`) fixes what goes in each position; a GraphQL
  // list has one item type for every position. e.g. (ashby) AuditLogFieldChange: { type: array,
  // prefixItems: [before, after] }  see docs/FIXED.md #204
  static tupleArray(): string {
    return 'this array fixes what goes in each position (a tuple), and a GraphQL list has one item type — sent as raw JSON instead.';
  }

  // e.g. (stripe) Customer.default_source: anyOf [string, $ref Card]
  static namedMembersAnyOf(): string {
    return 'an anyOf whose object members are named schemas is sent as raw JSON for now: building them here rebuilds shared schemas on every branch and does not finish on large specs, see docs/TASKS.md #223';
  }
}
