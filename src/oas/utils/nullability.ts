import { SchemaObject } from 'oas/types';

export class Nullability {
  // the keywords that say what the data can be; anything else (`description`, `x-` keys) is only
  // notes for people. One of these next to a choice list says more than the choice — left alone.
  // e.g. (required-nullable-oneof.yaml)
  //   properties:
  //     constrained:
  //       type: string     # says the data is a string, on top of the list below -> left alone
  //       oneOf:
  //         - type: string
  //         - type: "null"
  private static readonly SHAPE_KEYWORDS = [
    '$ref',
    'type',
    'enum',
    'items',
    'properties',
    'required',
    'additionalProperties',
    'allOf',
    'oneOf',
    'anyOf',
    'not',
  ];

  // Changes the given schema, so every reader sees the result; running it twice changes nothing.
  public static normalize(schema: SchemaObject): void {
    const source = schema as Record<string, unknown>;

    // OAS 3.1 writes "may be null" as a list of types — keep the first real one, mark nullable:
    //   { type: [string, 'null'] }  ->  { type: string, nullable: true }
    if (Array.isArray(source.type)) {
      const nonNullTypes = (source.type as unknown[]).filter((t) => t && t !== 'null');
      if (nonNullTypes.length < (source.type as unknown[]).length) {
        source.nullable = true;
      }
      // only the first real type survives — GraphQL has no "string or integer" field
      source.type = nonNullTypes[0];
    }

    // both choice-list spellings
    for (const key of ['oneOf', 'anyOf'] as const) {
      Nullability.removeNullChoice(source, key);
    }
  }

  // Takes the `or null` choice out of the list and marks the schema `nullable` instead. What is
  // left decides the shape. e.g. (required-nullable-oneof.yaml)
  //   properties:
  //     reqOneOf:          # one plain value left -> { type: string, nullable: true }
  //       oneOf:
  //         - type: string
  //         - type: "null"
  //     reqChoice:         # two $ref choices left -> stays a choice, only the `!` goes
  //     nullOnly:          # nothing left          -> JSON
  private static removeNullChoice(schema: Record<string, unknown>, key: 'oneOf' | 'anyOf'): void {
    const choices = schema[key];

    if (!Array.isArray(choices)) { // not an array? bail.
      return;
    }

    if (Nullability.SHAPE_KEYWORDS.some((shape) => shape !== key && schema[shape] != null)) { // one of the shapes above? bail.
      return;
    }

    // two null choices cancel out under oneOf — null would match both. e.g. doubleNull stays untouched
    const isNull = (choice: unknown) => (choice as SchemaObject)?.type === 'null';
    if (choices.filter(isNull).length !== 1) {
      return;
    }

    const kept = choices.filter((choice) => !isNull(choice));
    schema.nullable = true;

    if (kept.length === 0) {
      delete schema[key];
      return;
    }

    if (kept.length === 1 && Nullability.isPlainValue(kept[0] as SchemaObject)) {
      const value = kept[0] as Record<string, unknown>;
      for (const k of Object.keys(value)) {
        if (schema[k] == null) schema[k] = value[k];
      }
      delete schema[key];
      return;
    }
    
    schema[key] = kept;
  }

  // a plain string/number/boolean or a list — a value with no fields of its own. A choice that
  // also combines conditions is not plain; copying it up would change what the schema means.
  // No corpus spec writes this, so the shape is made up:
  //   properties:
  //     retryAfter:
  //       oneOf:
  //         - type: string     # plain so far...
  //           allOf:           # ...but these conditions come with it -> keep the choice list
  //             - pattern: "^PT"
  //         - type: "null"
  private static isPlainValue(choice: SchemaObject): boolean {
    // the same object, only relabelled so any key can be read — `as` changes nothing at runtime
    const choiceAsMap = choice as Record<string, unknown>;
    const hasPlainType = ['string', 'number', 'integer', 'boolean', 'array'].includes(choiceAsMap.type as string);

    // combined conditions next to the type would be copied onto the schema and read as its shape
    const carriesNothingElse = ['allOf', 'oneOf', 'anyOf', 'not'].every((key) => choiceAsMap[key] == null);

    return hasPlainType && carriesNothingElse;
  }
}
