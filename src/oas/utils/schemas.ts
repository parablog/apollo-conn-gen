import _ from 'lodash';
import { SchemaObject } from 'oas/types';
import type { OasContext } from '../oasContext.js';
import type { IType, ReferenceObject } from '../nodes/internal.js';
import { Arr, Obj, Res } from '../nodes/internal.js';
import { GqlUtils } from './gql.js';
import { Naming } from './naming.js';
import { ExpandedSelection } from './expandedSelection.js';

// Keywords that give a schema a renderable GraphQL shape; a schema with none is metadata-only. #5
const SHAPE_KEYWORDS = ['$ref', 'type', 'enum', 'items', 'allOf', 'oneOf', 'anyOf', 'additionalProperties'];

// What analyzeMixedValue found: which plain shapes the oneOf allows, and which of its members are objects.
export interface MixedValueShape {
  isText: boolean;
  isBoolean: boolean;
  isNumber: boolean;
  listItemType?: 'String' | 'JSON';
  objectMemberIndexes: number[];
}

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

  // True when a schema is read as a list: `items` with `type: array` or no type at all. see docs/FIXED.md #4
  //   e.g. (docker-engine) ContainerSummary: { type: array, items: { … } }  ->  true
  public static isList(schema: SchemaObject): boolean {
    return _.get(schema, 'items') != null && (schema.type === 'array' || schema.type == null);
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
      .map((member) => ('$ref' in member ? (context.resolvePointer(member.$ref!) as SchemaObject) : member))
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
      .map((member) => ('$ref' in member ? (context.resolvePointer(member.$ref!) as SchemaObject) : member))
      .filter((member) => member != null && !('$ref' in member) && member.type !== 'null');

    const isPlainValue = (member: SchemaObject) =>
      member.enum != null || (typeof member.type === 'string' && GqlUtils.gqlScalar(member.type) !== false);
    const isRealObject = (member: SchemaObject) => !isPlainValue(member) && !Schemas.isShapelessObject(member);

    return members.some(isPlainValue) && members.some(isRealObject);
  }

  // Which members of a oneOf/anyOf are a real object, and which plain shapes the others have. Works
  // on the schema, so it gives the same answer before or after a node exists. see docs/FIXED.md #208
  //   e.g. (ashby) oneOf: [boolean, { currencyCode, value }, string(date)] -> text, boolean, object
  public static analyzeMixedValue(
    context: OasContext,
    members: (SchemaObject | ReferenceObject)[],
  ): MixedValueShape | undefined {
    // the same order createContainerType checks the shapes in.
    const isRealObjectMember = (m: SchemaObject): boolean => {
      if (m.allOf != null) return true;
      if (m.oneOf != null || m.anyOf != null) return false;
      if (Schemas.isMap(m)) return false;
      return (m.type === 'object' || (m.type == null && !_.isEmpty(m.properties))) && !Schemas.isShapelessObject(m);
    };

    let isText = false;
    let isBoolean = false;
    let isNumber = false;
    let hasNonObject = false;
    let isList = false;
    let isStringList = true;
    // indexes into `members`, so a caller can map back to the child a Union built at that position.
    const objectMemberIndexes: number[] = [];

    for (let index = 0; index < members.length; index++) {
      const raw = members[index];
      const member = '$ref' in raw ? (context.resolvePointer(raw.$ref!) as SchemaObject | undefined) : raw;
      if (member == null || member.type === 'null') continue;

      if (isRealObjectMember(member)) {
        objectMemberIndexes.push(index);
        continue;
      }

      // A member that is neither a real object nor one of the plain shapes below (a shapeless
      // object, a map, an unknown type) counts as neither, as before.
      if (member.enum != null) {
        // an enum reads its own type first, not text by default — an integer enum is a number.
        //   e.g. oneOf: [integer enum [1, 2], object] -> number, not text
        hasNonObject = true;
        if (member.type === 'integer') {
          if (GqlUtils.gqlScalarFor(member, 'integer') === 'String') return undefined;
          isNumber = true;
        } else if (member.type === 'number') {
          isNumber = true;
        } else if (member.type === 'boolean') {
          isBoolean = true;
        } else if (member.type === 'string') {
          isText = true;
        } else {
          // no declared type: fall back to the values themselves.
          const values = member.enum as unknown[];
          if (values.every((v) => typeof v === 'number')) isNumber = true;
          else if (values.every((v) => typeof v === 'boolean')) isBoolean = true;
          else isText = true;
        }
      } else if (member.type === 'string') {
        hasNonObject = true;
        isText = true;
      } else if (member.type === 'boolean') {
        hasNonObject = true;
        isBoolean = true;
      } else if (member.type === 'integer') {
        // an integer too wide for Int is written as String; the same check createScalarType makes.
        if (GqlUtils.gqlScalarFor(member, 'integer') === 'String') {
          return undefined;
        }
        hasNonObject = true;
        isNumber = true;
      } else if (member.type === 'number') {
        hasNonObject = true;
        isNumber = true;
      } else if (member.type === 'array') {
        hasNonObject = true;
        isList = true;
        const items = member.items as SchemaObject | undefined;
        if (items?.type !== 'string') isStringList = false;
      }
    }

    // a list member beside a plain one is enough: { text, list, raw } needs no object. #221
    if (!hasNonObject || (objectMemberIndexes.length === 0 && !isList)) {
      return undefined;
    }

    return {
      isText,
      isBoolean,
      isNumber,
      listItemType: isList ? (isStringList ? 'String' : 'JSON') : undefined,
      objectMemberIndexes,
    };
  }

  // Recognises object members, including composed objects without an explicit type.
  // e.g. { allOf: [{ type: object, properties: { code: { type: string } } }] } -> true
  public static isObjectMember(member: SchemaObject): boolean {
    return member.type === 'object' || member.allOf != null || (member.type == null && !_.isEmpty(member.properties));
  }

  // True when a oneOf/anyOf mixes object members with plain ones (scalar, enum, array).
  //   e.g. (ashby) oneOf: [boolean, { currencyCode, value }, string]  ->  true. see docs/FIXED.md #208
  public static mixesObjectAndPlainMembers(context: OasContext, schema: SchemaObject): boolean {
    const choice = (schema.oneOf ?? schema.anyOf) as (SchemaObject | ReferenceObject)[] | undefined;
    if (!choice) {
      return false;
    }

    const members = choice
      .map((member) => ('$ref' in member ? (context.resolvePointer(member.$ref!) as SchemaObject) : member))
      .filter((member) => member != null && !('$ref' in member) && member.type !== 'null');

    // Both sides are needed: a oneOf of only plain values is a different case, handled by
    // scalarOnlyOneOf.
    return members.some(Schemas.isObjectMember) && members.some((member) => !Schemas.isObjectMember(member));
  }

  // Checks that every resolved, non-null choice member is an object.
  // e.g. anyOf: [$ref A { code required }, $ref B { code optional }] -> true
  public static holdsOnlyObjectMembers(context: OasContext, schema: SchemaObject): boolean {
    const choice = (schema.oneOf ?? schema.anyOf) as (SchemaObject | ReferenceObject)[] | undefined;
    if (!choice) {
      return false;
    }

    const members = choice
      .map((member) => ('$ref' in member ? (context.resolvePointer(member.$ref!) as SchemaObject) : member))
      .filter((member) => member != null && !('$ref' in member) && member.type !== 'null');

    return members.length > 0 && members.every(Schemas.isObjectMember);
  }

  // True when a choice (oneOf/anyOf), once $ref members resolve, holds nothing but arrays — the
  // list-shaped counterpart to holdsOnlyObjectMembers.
  //   e.g. (ashby) results: anyOf [ [string], [$ref HiringTeamRoleSummary] ] -> true
  public static holdsOnlyArrayMembers(context: OasContext, schema: SchemaObject): boolean {
    const choice = (schema.oneOf ?? schema.anyOf) as (SchemaObject | ReferenceObject)[] | undefined;
    if (!choice) {
      return false;
    }

    const members = choice
      .map((member) => ('$ref' in member ? (context.resolvePointer(member.$ref!) as SchemaObject) : member))
      .filter((member) => member != null && !('$ref' in member) && member.type !== 'null');

    return members.length > 0 && members.every((member) => member.type === 'array');
  }

  // Among an all-array choice, the one member whose items are an object — undefined if none or
  // more than one qualify. Returns the original (possibly $ref) member, not a resolved copy.
  //   e.g. (ashby) results: anyOf [ [string], [$ref HiringTeamRoleSummary] ] -> the second member
  public static findObjectItemsArrayMember(
    context: OasContext,
    schema: SchemaObject,
  ): SchemaObject | ReferenceObject | undefined {
    const choice = (schema.oneOf ?? schema.anyOf) as (SchemaObject | ReferenceObject)[] | undefined;
    if (!choice) {
      return undefined;
    }

    const arrayMembersWithObjectItems = choice.filter((original) => {
      const resolved = '$ref' in original ? (context.resolvePointer(original.$ref!) as SchemaObject) : original;
      if (resolved == null || resolved.type !== 'array') {
        return false;
      }
      const rawItems = resolved.items as SchemaObject | ReferenceObject | undefined;
      const items =
        rawItems && '$ref' in rawItems ? (context.resolvePointer(rawItems.$ref!) as SchemaObject) : rawItems;
      return items != null && Schemas.isObjectMember(items);
    });

    return arrayMembersWithObjectItems.length === 1 ? arrayMembersWithObjectItems[0] : undefined;
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
  // log, unless `skipDegradeReasons` asks for agent-facing SDL with no note. e.g. (docker-engine)
  // Labels: { additionalProperties: { type: string } } -> `labels: JSON` gets the docstring.
  public static withJsonNote(context: OasContext, schema: SchemaObject, reason: string): SchemaObject {
    const description = schema.description && Schemas.asciiSafeDashes(schema.description);
    if (context.generateOptions?.skipDegradeReasons === true) {
      return description ? { ...schema, description } : schema;
    }
    const note = Schemas.asciiSafeDashes(`NEEDS ATTENTION: ${reason}`);
    return { ...schema, description: description ? `${description}\n\n${note}` : note };
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

  // Builds the "Returns:" line --note-response-fields adds to an operation's description, naming
  // the top-level fields of what the operation actually sends back. Only two response shapes are
  // covered: a single object, or a list of one kind of object. Any other response — a plain
  // value, a mix of different types, a catch-all JSON blob, and so on — gets no line at all, so
  // a reader never sees a guess dressed up as a fact. see docs/FIXED.md #160
  //   e.g. (doc-response-fields.yaml) GET /items answers a list of { id, name, created_at }
  //   objects -> 'Returns a list of items with: createdAt, id, name'
  //   e.g. (doc-response-fields.yaml) GET /items/{item_id} answers one { id, name, created_at }
  //   object -> 'Returns: createdAt, id, name'
  public static describeResponseFields(
    resultType: IType | undefined,
    selection: ExpandedSelection,
    keep: boolean,
  ): string | undefined {
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
      .selectedProps(selection, keep, selection.writtenPath(response))
      .map((prop) => response.findFieldName(prop, keep));
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
