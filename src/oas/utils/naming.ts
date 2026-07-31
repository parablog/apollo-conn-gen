import _ from 'lodash';
import { Operation } from 'oas/operation';

interface Converter {
  convert(input: string): string;
}

abstract class AbstractConverter implements Converter {
  private next?: Converter;

  constructor(next?: Converter) {
    this.next = next;
  }

  public convert(input: string): string {
    const result = this.process(input);
    return this.next ? this.next.convert(result) : result;
  }

  protected abstract process(input: string): string;
}

class CapitalisePartsConverter extends AbstractConverter {
  constructor(next: Converter) {
    super(next);
  }

  public process(input: string): string {
    return Naming.capitaliseParts(input, /[-_.]/);
  }
}

class RemoveRefConverter extends AbstractConverter {
  constructor(converter: Converter) {
    super(converter);
  }

  public process(input: string): string {
    let result = input || '';
    // A schema $ref'd via a JSON-pointer into #/paths (DigitalOcean shares schemas this way) carries
    // the whole pointer as its name; derive a clean tail name instead. see docs/issues.md #8
    if (result.includes('#/paths/')) {
      return nameFromPathsPointer(result);
    }
    if (result.includes('#/components/schemas/')) {
      result = result.replace(/#\/components\/schemas\//g, '');
    }
    if (result.includes('#/components/responses/')) {
      result = result.replace(/#\/components\/responses\//g, '');
    }
    if (result.includes('#/components/parameters/')) {
      result = result.replace(/#\/components\/parameters\//g, '');
    }
    return result;
  }
}

// Structural JSON-pointer segments that don't make good type-name material.
const POINTER_NOISE = new Set([
  '#',
  'paths',
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'responses',
  'requestBody',
  'content',
  'schema',
  'allOf',
  'oneOf',
  'anyOf',
  'items',
  'properties',
  'parameters',
]);

/**
 * Derive a readable type name from a JSON pointer into `#/paths/...` (how DigitalOcean shares inline
 * schemas). See docs/issues.md #8.
 *
 * Input  (a raw pointer, RFC-6901 encoded):
 *   `#/paths/~1v2~1account~1keys/get/responses/200/content/application~1json/schema/.../properties/sshKeys/items`
 * Output (a bare name; the caller's `genTypeName` then capitalises it):
 *   `sshKeysItem`   ->  `SshKeysItem`
 *
 * Rules: decode `~1`/`~0`, then take the segment right after the last `properties` (`sshKeys`); if the
 * pointer targets array `items`, append `Item`. If there's no `properties`, use the last meaningful
 * segment (skipping structural keywords, array indices, and decoded path keys that contain `/`); if
 * nothing qualifies, fall back to `inline`.
 */
function nameFromPathsPointer(ref: string): string {
  const segments = ref.split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  const propIdx = segments.lastIndexOf('properties');

  let base = propIdx >= 0 ? segments[propIdx + 1] : undefined;
  if (!base) {
    base = [...segments].reverse().find((s) => !POINTER_NOISE.has(s) && !/^\d+$/.test(s) && !s.includes('/'));
  }
  if (!base) base = 'inline';

  return segments[segments.length - 1] === 'items' ? base + 'Item' : base;
}

class FinalFirstUpperCaseConverter extends AbstractConverter {
  constructor() {
    super();
  }
  public process(input: string): string {
    return _.upperFirst(input);
  }
}

class FinalConverter extends AbstractConverter {
  protected process(input: string): string {
    return input; // do nothing
  }
}

class EncodeLeadingSignConverter extends AbstractConverter {
  // a leading sign would be dropped by the generic sanitiser, colliding `+1` and `-1` (github's
  // ReactionRollup) into one `_1` field — encode it into the name instead. see docs/issues.md #24
  public process(input: string): string {
    if (input.startsWith('+')) return 'plus' + input.substring(1);
    if (input.startsWith('-')) return 'minus' + input.substring(1);
    return input;
  }
}

class ParamNameConverter extends AbstractConverter {
  public process(input: string): string {
    return Naming.genParamName(input);
  }
}

export class Naming {
  // GraphQL keeps these three names for itself. A schema called one of them (stripe's
  // `Subscription`) can't also be an ordinary type. see docs/issues.md #45
  private static readonly RESERVED_ROOT_TYPE_NAMES = new Set(['Query', 'Mutation', 'Subscription']);

  public static genParamName(param: string): string {
    // Split on any run of non-alphanumeric characters, camelCase the parts, then
    // guarantee a valid GraphQL identifier: non-empty and not starting with a digit.
    // (Plain `[-_.]` splitting let spaces, `$`, `%`, … and leading digits through.)
    const camel = _.lowerFirst(Naming.capitaliseParts(param || '', /[^A-Za-z0-9]+/));
    if (camel.length === 0) {
      return Naming.NUMBER_PREFIX;
    }
    return /^[0-9]/.test(camel) ? Naming.NUMBER_PREFIX + camel : camel;
  }

  // Selection paths abbreviate component refs to stay readable (`#/components/schemas/Space`
  // -> `#/c/s/Space`); expandRef is the inverse, used when matching a path segment back
  // against node ids.
  public static abbreviateRef(path: string): string {
    return path.replace(/#\/components\/schemas/g, '#/c/s');
  }

  public static expandRef(path: string): string {
    return path.replace(/#\/c\/s/g, '#/components/schemas');
  }

  public static genTypeName(name: string): string {
    // guarantee a valid type identifier: drop any leftover non-identifier chars (e.g. the
    // `[`/`]`/`:` of an `[inline:Foo]` placeholder used as a name prefix), then non-empty +
    // no leading digit. Idempotent for valid names. see docs/issues.md #6, #9
    const cleaned = Naming.TYPE_CONVERTER.convert(name).replace(/[^_0-9A-Za-z]/g, '');
    if (cleaned.length === 0) {
      return Naming.NUMBER_PREFIX;
    }
    const identifier = /^[0-9]/.test(cleaned) ? Naming.NUMBER_PREFIX + cleaned : cleaned;
    // every name goes through here, so the definition and everything pointing at it stay in step
    return Naming.RESERVED_ROOT_TYPE_NAMES.has(identifier) ? identifier + 'Type' : identifier;
  }

  public static sanitiseField(name: string): string {
    const fieldName = name.startsWith('@') ? name.substring(1) : name;
    return Naming.FIELD_CONVERTER.convert(fieldName);
  }

  public static sanitiseFieldForSelect(name: string, isInput: boolean = false): string {
    const fieldName = name.startsWith('@') ? name.substring(1) : name;
    const sanitised = Naming.FIELD_CONVERTER.convert(fieldName);

    // The JSON key is already a valid identifier identical to the field — no alias needed.
    if (sanitised === name) {
      return sanitised;
    }

    if (isInput) {
      // Request-body direction: original JSON key <- GraphQL input field. The KEY is quoted
      // when it isn't a bare identifier (omni's `urn:omni:params:1.0:UserAttribute` broke the
      // parser unquoted); the field reference is always a bare identifier. see #32
      const key = /^[_A-Za-z][_0-9A-Za-z]*$/.test(name) ? name : `"${name}"`;
      return key + ': ' + sanitised;
    }

    // Response direction: safe GraphQL field <- original JSON key, always quoted (the key
    // is not a bare identifier — covers spaces, `$`, `%`, leading digits, etc.).
    const original = name.startsWith('@') ? name : fieldName;
    return `${sanitised}: "${original}"`;
  }

  public static genOperationName(path: string, operation: Operation): string {
    const parameters = operation.hasParameters()
      ? operation
          .getParameters()
          .filter((p) => p.required && p.in.toLowerCase() !== 'header')
          .map((p) => {
            const paramName = Naming.genParamName(p.name);
            return `By${_.upperFirst(paramName)}`;
          })
      : [];

    const result = Naming.formatPath(path, parameters);
    return _.lowerFirst(result);
  }

  public static genArrayItems(name: string): string {
    return _.upperFirst(Naming.genParamName(name)) + 'Item';
  }

  public static getRefName(ref: string): string {
    return ref ? Naming.REF_CONVERTER.convert(ref) : '';
  }

  public static formatPath(path: string, parameters: string[]): string {
    if (!path) {
      return path;
    }

    // Step 1: Remove parameters enclosed in {}.
    const paramsJoined = parameters.join('');
    let cleanedPath = path.replace(/\{[^}]*\}/g, paramsJoined);

    // Split `#` for GraphQL field names because SDL treats `#` as a comment marker. Box's
    // `/shared_items#web_links` becomes `shared_itemsWeb_links`; the connector HTTP path still
    // comes from operation.path as `GET: "/shared_items#web_links"`.
    cleanedPath = Naming.capitaliseParts(cleanedPath, /[:\-.+#]+/);

    // Step 2: Split the path by "/" and capitalize each part.
    const capitalisedParts = Naming.capitaliseParts(cleanedPath, '/');

    // Step 3: Check if the path starts with a number and remove it if so
    // the pattern we are looking for is like so: /2.3.0/entrypoint
    if (/^\d/.test(capitalisedParts)) {
      return capitalisedParts.replace(/^\d+(?=[a-zA-Z])/g, '');
    }

    return capitalisedParts;
  }

  public static capitaliseParts(input: string, splitPattern: RegExp | string): string {
    // If splitPattern is a string, convert it to a RegExp.
    const regex = typeof splitPattern === 'string' ? new RegExp(splitPattern, 'g') : splitPattern;

    // Split the input, capitalize each non-empty part, and join them back together.
    return input
      .split(regex)
      .map((part) => (part ? _.upperFirst(part) : ''))
      .join('');
  }
  private static readonly TYPE_CONVERTER: Converter = new RemoveRefConverter(
    new CapitalisePartsConverter(new FinalFirstUpperCaseConverter()),
  );

  private static readonly REF_CONVERTER: Converter = new RemoveRefConverter(new FinalConverter());

  private static readonly FIELD_CONVERTER: Converter = new EncodeLeadingSignConverter(
    new ParamNameConverter(new FinalConverter()),
  );

  // internal stuff
  private static readonly NUMBER_PREFIX = '_';

  public formatPath(path: string, parameters: string[]): string {
    // Replace with your actual formatting logic.
    // This example simply concatenates the parameters to the path.
    return path + parameters.join('');
  }
}
