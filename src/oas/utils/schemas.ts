import _ from 'lodash';
import { SchemaObject } from 'oas/types';
import type { OasContext } from '../oasContext.js';
import type { ReferenceObject } from '../nodes/internal.js';
import { GqlUtils } from './gql.js';

// Keywords that give a schema a renderable GraphQL shape; a schema with none is metadata-only. #5
const SHAPE_KEYWORDS = ['$ref', 'type', 'enum', 'items', 'allOf', 'oneOf', 'anyOf', 'additionalProperties'];

// Questions about an OAS schema's shape, asked while building nodes. Nothing here creates a node.
export class Schemas {
  // True when a schema says nothing about its shape — a description and no more.
  //   e.g. (TMF637) `{ description: 'The product', example: … }`  ->  true               #5
  public static isEmpty(schema: SchemaObject | ReferenceObject): boolean {
    const s = schema as Record<string, unknown>;
    return SHAPE_KEYWORDS.every((k) => s[k] == null) && _.isEmpty(s.properties);
  }

  // True for an object that declares no fields. A real map (`additionalProperties: <schema>`) is
  // not this — it takes any key the caller wants, which is a shape.
  //   e.g. (googlebooks) Empty: { type: object, properties: {} }  ->  true          #19 #31
  public static isShapelessObject(schema: SchemaObject): boolean {
    const s = schema as Record<string, unknown>;
    const noShape = ['$ref', 'enum', 'items', 'allOf', 'oneOf', 'anyOf'].every((k) => s[k] == null);
    const objectOrUntyped = s.type == null || s.type === 'object';
    return noShape && objectOrUntyped && _.isEmpty(s.properties) && typeof s.additionalProperties !== 'object';
  }

  // True when a schema takes any key the caller wants, instead of naming its fields.
  //   e.g. (docker-engine) Labels: { type: object, additionalProperties: { type: string } }
  public static isMap(schema: SchemaObject): boolean {
    return Boolean(
      schema.additionalProperties &&
        typeof schema.additionalProperties === 'object' &&
        (!schema.properties || _.isEmpty(schema.properties)),
    );
  }

  // True when a choice lists nothing but plain values — strings, numbers, enums, or refs to them.
  // A `null` member does not count, and two objects are a real union, left alone.
  //   e.g. (confluence) anyOf: [{ type: string }, { type: integer }] -> true            #86
  public static holdsPlainValues(context: OasContext, schema: SchemaObject): boolean {
    const choice = (schema.oneOf ?? schema.anyOf) as (SchemaObject | ReferenceObject)[] | undefined;
    if (!choice) {
      return false;
    }

    const members = choice
      .map((member) => ('$ref' in member ? (context.lookupRef(member.$ref!) as SchemaObject) : member))
      .filter((member) => member != null && !('$ref' in member) && member.type !== 'null');

    // a member is a plain value when it is an enum or a type GraphQL has a scalar for. `type` can
    // also be a list (`type: [string, 'null']`, OAS 3.1), which is left to the normal route.
    const isPlainValue = (member: SchemaObject) =>
      member.enum != null || (typeof member.type === 'string' && GqlUtils.gqlScalar(member.type) !== false);

    // one member left is #20's case: the choice collapses to it, and that still works
    return members.length > 1 && members.every(isPlainValue);
  }
}
