/**
 * Shapes for the selection linter. Every position is an offset into the SDL text the user is
 * editing, so the editor can underline a problem and apply a fix without working anything out.
 */

export type Severity = 'error' | 'warning';

/** A ready-made edit: replace the text between `from` and `to` with `insert`. */
export interface LintFix {
  title: string;
  from: number;
  to: number;
  insert: string;
}

export interface LintDiagnostic {
  code: string;
  severity: Severity;
  message: string;
  from: number;
  to: number;
  fix?: LintFix;
}

/**
 * Which selection a field was written in. `$` and `@` mean different things in each, so a check
 * that cares about them has to know where it is.
 *
 *   connectSelection   the text of @connect(selection: "...")
 *   mappingSelection   the top level of @mapping(selection: "...")
 *   nestedBlock        inside `category { ... }`
 *   methodArgument     inside the brackets of `->map(...)`
 *   definitionBody     inside a `($low, $high) => ...` definition
 */
export type SelectionPlace =
  | 'connectSelection'
  | 'mappingSelection'
  | 'nestedBlock'
  | 'methodArgument'
  | 'definitionBody';

/**
 * What the value is read from, before any `->` methods run.
 *
 *   status              startsAt 'fieldName', pathParts [status]
 *   category.name       startsAt 'fieldName', pathParts [category, name]
 *   $                   startsAt 'dollar',    pathParts []
 *   $.data              startsAt 'dollar',    pathParts [data]
 *   @                   startsAt 'atSign',    pathParts []
 */
export interface ValueSource {
  startsAt: 'dollar' | 'atSign' | 'fieldName' | 'nothing';
  /** the dotted steps after the start; quotes are stripped from `"odd-key"` */
  pathParts: NamedSpan[];
}

/** A name and where it sits in the SDL, so a diagnostic can point straight at it. */
export interface NamedSpan {
  name: string;
  from: number;
  to: number;
}

// One field of a selection, e.g. `category: category->Category`. `outputName` is the alias, or the
// field's own name; absent for `...@->Other`, which merges a shape in without naming it. Each entry
// of `methods` is one `->name` call, e.g. the `first` of `photoUrls->first`.
export interface SelectedField {
  outputName?: NamedSpan;
  isMerge: boolean;
  readsFrom: ValueSource;
  methods: NamedSpan[];
  place: SelectionPlace;
  /** the fields inside `{ ... }`, when the field has a block */
  nested?: SelectedField[];
  from: number;
  to: number;
  /**
   * The text could not be read — normally because the user is still typing it. Checks skip these
   * and everything after them in the same selection, so nothing is reported on a guess.
   */
  unreadable: boolean;
}

/** One `selection:` argument found in the SDL, read into fields. */
export interface Selection {
  /** the type the directive sits on, or `Query`/`Mutation` for a @connect */
  ownerType: string;
  /** the field the @connect sits on; absent for a type-level @mapping */
  ownerField?: string;
  directive: 'mapping' | 'connect';
  /**
   * For a @connect, the operation it calls, spelled the way the generator keys its `paths` map:
   * `@connect(http: { GET: "/pet/findByStatus" })` is `get:/pet/findByStatus`.
   */
  operationKey?: string;
  fields: SelectedField[];
  from: number;
  to: number;
}

export interface SchemaField {
  name: string;
  /** the type with `[]` and `!` taken off: `[Pet!]!` is `Pet` */
  typeName: string;
  /** how many lists are wrapped around it: `Pet` 0, `[Pet]` 1, `[[Pet]]` 2 */
  listDepth: number;
}

export interface SchemaType {
  name: string;
  fields: SchemaField[];
  /** the type carries `@mapping` */
  hasMapping: boolean;
  /** the `@mapping` spells its fields out, rather than the bare `@mapping` that works them out */
  hasSelection: boolean;
}

/** Everything the checks read: the SDL's types, and every selection in it. */
export interface ParsedSchema {
  types: Map<string, SchemaType>;
  selections: Selection[];
  /** the SDL did not parse at all, so every check stays quiet */
  unreadable: boolean;
}
