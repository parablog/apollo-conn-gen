import _ from 'lodash';
import { SchemaObject } from 'oas/types';

export class GqlUtils {
  // True when every value is a legal GraphQL enum value once trimmed (TMF637 ships `'aborted '`):
  // a bare identifier that is not a boolean or null. Numbers and `+1` have no enum form.
  //   e.g. (github) reactions `enum: ["+1", "-1"]`  ->  false, written as String          #24
  public static isGqlEnum(schema: SchemaObject): boolean {
    const VALID_ENUM_VALUE = /^[_A-Za-z][_0-9A-Za-z]*$/;
    const RESERVED = new Set(['true', 'false', 'null']);
    return _.every(schema.enum, (value) => {
      if (typeof value !== 'string') return false;
      const trimmed = value.trim();
      return VALID_ENUM_VALUE.test(trimmed) && !RESERVED.has(trimmed);
    });
  }

  public static getGQLScalarType(schema: SchemaObject): string {
    switch (schema.type) {
      case 'string':
        // case 'date':
        // case 'date-time':
        return 'String';
      case 'integer':
        return 'Int';
      case 'number':
        return 'Float';
      case 'boolean':
        return 'Boolean';
      default:
        throw new Error(`[getGQLScalarType] Cannot generate type = ${JSON.stringify(schema)}`);
    }
  }

  public static gqlScalar(type: string): string | false {
    switch (type) {
      case 'string':
      case 'date':
      case 'date-time':
        return 'String';
      case 'integer':
        return 'Int';
      case 'number':
        return 'Float';
      case 'boolean':
        return 'Boolean';
      default:
        return false;
    }
  }

  // GraphQL's Int is spec-defined as SIGNED 32-BIT. An OAS `integer` maps to it soundly only
  // when nothing in the spec says the value can exceed that range. `format: int64` or declared
  // JSON-Schema bounds outside Int32 are proof it can — emit String instead: a wider numeric
  // type doesn't survive transport (integer literals beyond 2^31 fail the router's connectors
  // argument parsing regardless of the declared GraphQL type, and Float loses precision past
  // 2^53), while a quoted string round-trips exactly and upstreams coerce numeric strings.
  //   e.g. a 16-digit `card_number` { type: integer, exclusiveMaximum: 1e16 } as Int! makes
  //   every legal value unrepresentable — the operation cannot ever be called successfully.
  private static readonly INT32_MIN = -(2 ** 31);
  private static readonly INT32_MAX = 2 ** 31 - 1;

  public static gqlScalarFor(
    schema:
      | {
          type?: unknown;
          format?: unknown;
          minimum?: unknown;
          maximum?: unknown;
          exclusiveMinimum?: unknown;
          exclusiveMaximum?: unknown;
        }
      | null
      | undefined,
    typeStr: string,
  ): string | false {
    const base = GqlUtils.gqlScalar(typeStr);
    if (base !== 'Int' || !schema) {
      return base;
    }
    if (schema.format === 'int64') {
      return 'String';
    }
    const bounds = [schema.minimum, schema.maximum, schema.exclusiveMinimum, schema.exclusiveMaximum].filter(
      (b): b is number => typeof b === 'number',
    );
    if (bounds.some((b) => b < GqlUtils.INT32_MIN || b > GqlUtils.INT32_MAX)) {
      return 'String';
    }
    return base;
  }
}
