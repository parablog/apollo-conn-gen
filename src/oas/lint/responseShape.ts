import type { SchemaObject } from 'oas/types';
import type { OasGen } from '../oasGen.js';
import { T } from '../nodes/internal.js';
import _ from 'lodash';

/** What the spec says about a key the selection asked for. */
export type KeyLookup =
  /** the response declares it */
  | 'found'
  /** not in `properties`, but the spec does not say extra keys are banned */
  | 'notDocumented'
  /** not in `properties` and `additionalProperties: false` — it cannot be there */
  | 'forbidden'
  /** free-form or unresolvable, so nothing can be said either way */
  | 'cannotTell';

/** Looks up selection paths in the response the operation actually returns. */
export class ResponseShape {
  /** The response object a @connect selection reads, or undefined when it cannot be worked out. */
  public static forOperation(gen: OasGen, operationKey: string): SchemaObject | undefined {
    const operation = gen.paths.get(operationKey);
    return operation && T.isOp(operation) ? T.responseItemSchema(operation) : undefined;
  }

  /**
   * Whether the response may carry this key.
   *
   * JSON Schema only bans a key when `additionalProperties: false` says so, and plenty of specs
   * leave `additionalProperties` off entirely while still listing every property they mean. So a
   * missing key is only an error in the first case; otherwise it is worth mentioning, no more.
   * Anything free-form says nothing at all — this can miss a bad path, but never blames a good one.
   */
  public static look(schema: SchemaObject | undefined, key: string): KeyLookup {
    const choices = ResponseShape.choices(schema);
    if (choices.length === 0) {
      return 'cannotTell';
    }
    let softest: KeyLookup = 'forbidden';
    for (const choice of choices) {
      const lookup = ResponseShape.lookInOne(choice, key);
      if (lookup === 'found' || lookup === 'cannotTell') {
        return lookup;
      }
      if (lookup === 'notDocumented') {
        softest = 'notDocumented';
      }
    }
    return softest;
  }

  private static lookInOne(schema: SchemaObject, key: string): KeyLookup {
    if (_.isEmpty(schema.properties)) {
      return 'cannotTell';
    }
    if (_.has(schema.properties, key)) {
      return 'found';
    }
    if (schema.additionalProperties === false) {
      return 'forbidden';
    }
    // `true` or a schema: extra keys are declared, so anything goes
    return schema.additionalProperties === undefined ? 'notDocumented' : 'cannotTell';
  }

  /** The schema of one property, so `category.name` can be followed a step at a time. */
  public static propertySchema(schema: SchemaObject | undefined, key: string): SchemaObject | undefined {
    for (const choice of ResponseShape.choices(schema)) {
      const property = _.get(choice.properties, key);
      if (_.isObject(property) && !_.has(property, '$ref')) {
        return ResponseShape.itemSchema(property as SchemaObject);
      }
    }
    return undefined;
  }

  // A key only has to satisfy one branch of a oneOf/anyOf. An allOf is the opposite — the parts are
  // merged, so a key in any part counts, which is the same test over the parts plus the whole.
  private static choices(schema: SchemaObject | undefined): SchemaObject[] {
    if (!_.isObject(schema) || _.has(schema, '$ref')) {
      return [];
    }
    const unwrapped = ResponseShape.itemSchema(schema);
    const isUsable = (part: unknown): part is SchemaObject => _.isObject(part) && !_.has(part, '$ref');

    const alternatives = [...(unwrapped.oneOf ?? []), ...(unwrapped.anyOf ?? [])].filter(isUsable);
    if (alternatives.length > 0) {
      return alternatives;
    }
    const parts = (unwrapped.allOf ?? []).filter(isUsable);
    return parts.length > 0 ? [unwrapped, ...parts] : [unwrapped];
  }

  // `tags: [Tag]` is selected one Tag at a time, so the list wrapper is not part of the lookup
  private static itemSchema(schema: SchemaObject): SchemaObject {
    let current = schema;
    while (current.type === 'array' && _.isObject(current.items)) {
      current = current.items as SchemaObject;
    }
    return current;
  }
}
