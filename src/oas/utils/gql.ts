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
}
