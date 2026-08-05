// The methods a connector selection may call after `->`, e.g. `photoUrls->first`.
export class ArrowMethods {
  // Taken from the router's json_selection/methods.rs. `ArrowMethod::lookup` only accepts a method
  // when `is_public()` says so, and typeof/keys/values/has/matchIf are not public — the router
  // rejects a schema that calls them, so listing them here would let a broken schema through.
  // Re-check this list against that file whenever the router is upgraded.
  private static readonly NAMES: ReadonlySet<string> = new Set([
    'add',
    'and',
    'as',
    'contains',
    'div',
    'echo',
    'entries',
    'eq',
    'filter',
    'find',
    'first',
    'get',
    'gt',
    'gte',
    'in',
    'joinNotNull',
    'jsonParse',
    'jsonStringify',
    'keysToCamelCase',
    'keysToCamelCaseDeep',
    'last',
    'lt',
    'lte',
    'map',
    'match',
    'mod',
    'mul',
    'ne',
    'not',
    'or',
    'parseInt',
    'size',
    'slice',
    'split',
    'sub',
    'toString',
    'trim',
    'trimEnd',
    'trimStart',
  ]);

  public static has(name: string): boolean {
    return ArrowMethods.NAMES.has(name);
  }

  // for the editor's autocomplete after `->`
  public static all(): string[] {
    return [...ArrowMethods.NAMES];
  }
}
