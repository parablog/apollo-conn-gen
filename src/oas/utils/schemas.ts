import _ from 'lodash';
import { SchemaObject } from 'oas/types';
import type { OasContext } from '../oasContext.js';
import type { IType, ReferenceObject } from '../nodes/internal.js';
import { Arr, Obj, Res } from '../nodes/internal.js';
import { GqlUtils } from './gql.js';
import { Naming } from './naming.js';

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

  // True for `type: object` with no fields and an `items` schema beside it — the items are the
  // real shape. e.g. (slack) reactions.get 200: { type: object, items: { anyOf: [...] } }. see docs/FIXED.md #97 #114
  public static isFieldlessObjectWithItems(schema: SchemaObject): boolean {
    return schema.type === 'object' && _.isEmpty(schema.properties) && _.get(schema, 'items') != null;
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

  // True when a choice mixes a plain value with a real object — an "expandable" field: unexpanded
  // the API sends a bare ID string, expanded it sends the full object. #131
  //   e.g. (stripe/pagerduty) anyOf: [{ type: string }, $ref Owner, $ref DeletedOwner] -> true
  public static holdsMixedPlainAndObjectValues(context: OasContext, schema: SchemaObject): boolean {
    const choice = (schema.oneOf ?? schema.anyOf) as (SchemaObject | ReferenceObject)[] | undefined;
    if (!choice) {
      return false;
    }

    const members = choice
      .map((member) => ('$ref' in member ? (context.lookupRef(member.$ref!) as SchemaObject) : member))
      .filter((member) => member != null && !('$ref' in member) && member.type !== 'null');

    const isPlainValue = (member: SchemaObject) =>
      member.enum != null || (typeof member.type === 'string' && GqlUtils.gqlScalar(member.type) !== false);
    const isRealObject = (member: SchemaObject) => !isPlainValue(member) && !Schemas.isShapelessObject(member);

    return members.some(isPlainValue) && members.some(isRealObject);
  }

  // True for a flat object whose fields are all plain text - no nesting, lists, references, or
  // files. e.g. (swagger2-formdata.yaml) /upload's title and description fields -> true.
  // /avatar mixes in a `file` field -> false   #137
  public static isPlainStringForm(schema: SchemaObject): boolean {
    if (schema.type !== 'object' || _.isEmpty(schema.properties)) return false;
    const properties = Object.values(schema.properties) as (SchemaObject | ReferenceObject)[];
    return properties.every(
      (property) => !('$ref' in property) && property.type === 'string' && property.format !== 'binary',
    );
  }

  // Marks a schema about to fall back to JSON, so the reason lands in the SDL, not just the console
  // log. e.g. (docker-engine) Labels: { additionalProperties: { type: string } } in a request body
  // -> `labels: JSON` gets a "NEEDS ATTENTION: ..." docstring. see docs/FIXED.md #133, #152
  public static withJsonNote(schema: SchemaObject, reason: string): SchemaObject {
    const note = Schemas.asciiSafeDashes(`NEEDS ATTENTION: ${reason}`);
    const description = schema.description
      ? `${Schemas.asciiSafeDashes(schema.description)}\n\n${note}`
      : note;
    return { ...schema, description };
  }

  // Writes one parameter's default, minimum, maximum, and allowed values as plain words for the
  // "Params:" note --skip-arg-defaults adds to an operation. Allowed-value lists show the first
  // eight, then a count; a default drawn from such a list is spelled bare, like the list itself.
  // see docs/FIXED.md #159. e.g. (skip-arg-defaults.yaml):
  //   limit: { type: integer, default: 20, minimum: 1, maximum: 100 } -> 'limit (default 20, min 1, max 100)'
  //   sort: { type: string, enum: [asc, desc], default: asc }         -> 'sort (default asc, one of asc|desc)'
  //   region: { enum: [na, sa, ...ten values] }                       -> 'region (one of na|sa|eu|af|me|sas|eas|sea (+2 more))'
  //   verbose: { type: boolean }                                      -> undefined
  public static describeParamDefault(name: string, schema: SchemaObject, defaultValue: unknown): string | undefined {
    const enumValues = schema?.enum;
    const parts: string[] = [];
    if (defaultValue !== null && defaultValue !== undefined) {
      parts.push(`default ${enumValues ? String(defaultValue) : Schemas.formatParamValue(defaultValue)}`);
    }
    if (schema?.minimum !== undefined) {
      parts.push(`min ${schema.minimum}`);
    }
    if (schema?.maximum !== undefined) {
      parts.push(`max ${schema.maximum}`);
    }
    if (enumValues != null && enumValues.length > 0) {
      const shown = enumValues.slice(0, 8).map(String).join('|');
      const hidden = enumValues.length - 8;
      parts.push(hidden > 0 ? `one of ${shown} (+${hidden} more)` : `one of ${shown}`);
    }
    return parts.length > 0 ? `${name} (${parts.join(', ')})` : undefined;
  }

  // Builds the "Returns:" line --doc-response-fields adds to an operation's description, naming
  // the top-level fields of what the operation actually sends back. Only two response shapes are
  // covered: a single object, or a list of one kind of object. Any other response — a plain
  // value, a mix of different types, a catch-all JSON blob, and so on — gets no line at all, so
  // a reader never sees a guess dressed up as a fact. see docs/FIXED.md #160
  //   e.g. (doc-response-fields.yaml) GET /items answers a list of { id, name, created_at }
  //   objects -> 'Returns a list of items with: createdAt, id, name'
  //   e.g. (doc-response-fields.yaml) GET /items/{item_id} answers one { id, name, created_at }
  //   object -> 'Returns: createdAt, id, name'
  public static describeResponseFields(resultType: IType | undefined, selection: string[], keep: boolean): string | undefined {
    // every response is wrapped one level deep; step past that wrapper to the actual answer
    let response = resultType instanceof Res ? resultType.response : resultType;

    // a response that is a list (like GET /items above) names the one kind of thing inside it
    let isList = false;
    if (response instanceof Arr) {
      response = response.itemsType;
      isList = true;
    }

    // nothing left with fields to name — a plain value, a mix of types, a catch-all JSON blob
    if (!(response instanceof Obj)) {
      return undefined;
    }

    const names = response
      .selectedProps(selection, keep)
      .map((prop) => prop.renamedTo ?? Naming.sanitiseField(prop.name, keep));
    if (names.length === 0) {
      return undefined;
    }

    // a long field list is cut short so the line stays readable, e.g. 16 fields shows the first
    // 14 then "(+2 more)"
    const shown = names.slice(0, 14).join(', ');
    const hidden = names.length - 14;
    const fields = hidden > 0 ? `${shown} (+${hidden} more)` : shown;

    return isList ? `Returns a list of items with: ${fields}` : `Returns: ${fields}`;
  }

  // Writes a default value the way a person would type it: text in quotes, a plain number or
  // true/false left bare. e.g. a default of "" (an empty piece of text) becomes '""'; a default
  // of 5 becomes '5'.
  private static formatParamValue(value: unknown): string {
    return typeof value === 'string' ? `"${value}"` : String(value);
  }

  // A multi-byte dash character in a doc comment can crash rover mid-compose. see docs/FIXED.md #152
  private static asciiSafeDashes(text: string): string {
    return text.replace(/[‒-―−]/g, '--');
  }
}
