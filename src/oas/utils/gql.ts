import { SchemaObject } from 'oas/types';

export class GqlUtils {
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
