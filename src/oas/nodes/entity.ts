import { IType, Obj, Res, T } from './internal.js';
import { OasContext } from '../oasContext.js';
import { OasGen } from '../oasGen.js';

/**
 * A type-level entity resolver discovered by {@link inferEntityResolvers} (R1): a
 * GET-by-key endpoint that resolves an entity from its key fields. Drives the `@key` +
 * type-level `@connect(... { GET: ".../{$this.<key>}" } ...)` emission on the entity type.
 *
 * Lives on the entity {@link Obj} itself (`Obj.entityResolvers`), not on the context —
 * there is exactly one type per name (GraphQL spec), so the canonical, generated `Obj`
 * instance is the natural home for this.
 */
export interface EntityResolver {
  /** Composite key field-set, path-param names space-joined (e.g. "id", "orgId id"). */
  keyFields: string;
  /** REST path template of the qualifying op, e.g. "/widgets/{id}". */
  path: string;
  /** HTTP verb of the qualifying op (GET for this slice). */
  verb: string;
  /** The `@source` name the connector references. */
  source: string;
  /** R6: set on a batch resolver — same @key/selection, but $batch instead of $this. */
  batch?: BatchSpec;
}

/** R6: the batch `@connect` spec attached to a resolver — built by `applyBatchResolvers`. */
export interface BatchSpec {
  /** `<param>: $batch.<key>` query mapping (with any array join); mutually exclusive with `body`. */
  queryParams?: string;
  /** `<prop>: $batch.<key>` body mapping; mutually exclusive with `queryParams`. */
  body?: string;
  /** wrap the selection as `$.<wrapperKey> { … }` when the response array is wrapped. */
  wrapperKey?: string;
  /** the `batch: { maxSize }` cap. */
  maxSize: number;
}

/**
 * Unwrap a GET op's `resultType` to the single underlying object, or `null`.
 *
 * `resultType` is a {@link Res} wrapper (set by `Factory.fromResponse`); the actual
 * response type lives on `Res.response`. Only a plain {@link Obj} qualifies — arrays,
 * scalars, unions and composed types return `null`, so list/collection GETs and
 * scalar responses never look like entity resolvers.
 */
function unwrapToObj(resultType: IType | undefined): Obj | null {
  let node: IType | undefined = resultType;
  if (node instanceof Res) {
    node = node.response;
  }
  return node instanceof Obj ? node : null;
}

/**
 * Discover which GET-by-key operations in the selection are valid entity resolvers and
 * record them on the entity type they resolve, as type-level resolvers (`@connect`/`$this`
 * on the type — the modern Connectors form, preferred over Query-field `entity: true`).
 *
 * The resolvers are attached to the canonical, generated `Obj` instance found via the
 * collected `types` map (keyed by type id), so multiple qualifying ops on the same type
 * (multi-key) accumulate onto the single type the writer emits. The pass first clears any
 * prior resolvers so repeated generations don't leak, then — only when
 * `context.generateOptions.inferEntityResolvers` is on — populates them. With the flag off
 * it just resets, and the output stays byte-identical to the literal conversion.
 *
 * A GET op qualifies iff ALL hold:
 *  - verb is GET;
 *  - `resultType` unwraps (through `Res`) to a single `Obj` (not array/scalar/union);
 *  - it has >= 1 path param;
 *  - every path-param name exactly matches a scalar field on the resolved `Obj` that is
 *    also in `obj.selectedProps(selection)` (else the `@key`/`$this` field would dangle).
 *
 * Exact-name matching is deliberate: `/pet/{petId}` -> `Pet { id }` does NOT qualify
 * (`petId` != `id`). Alias mapping is a later enhancement to this flagged path.
 */
export function inferEntityResolvers(
  context: OasContext,
  gen: OasGen,
  types: Map<string, IType>,
  selection: string[],
): void {
  // Reset on the canonical (generated) type instances so a re-run can't leak resolvers.
  for (const type of types.values()) {
    if (type instanceof Obj) {
      type.entityResolvers = [];
    }
  }

  if (!context.generateOptions.inferEntityResolvers) {
    return;
  }

  // The root id of every selected path (matches how the writers pick query fields).
  const selectionRoots = new Set<string>(selection.map((s) => s.split('>')[0]));

  for (const op of gen.paths.values()) {
    if (!T.isOp(op) || op.verb !== 'GET' || !selectionRoots.has(op.id)) {
      continue;
    }

    const obj = unwrapToObj(op.resultType);
    if (!obj) {
      continue;
    }

    const pathParams = op.params.filter((p) => p.parameter.in && p.parameter.in.toLowerCase() === 'path');
    if (pathParams.length === 0) {
      continue;
    }

    const selected = obj.selectedProps(selection);
    const everyParamMatchesSelectedScalar = pathParams.every((p) => {
      const prop = obj.props.get(p.name);
      return prop !== undefined && T.isPropScalar(prop) && selected.includes(prop);
    });

    if (!everyParamMatchesSelectedScalar) {
      continue;
    }

    // Attach to the single canonical type instance the writer will generate (same id).
    const target = types.get(obj.id);
    if (!(target instanceof Obj)) {
      continue;
    }

    // Composite key for this resolver: path-param names in path order, single-space
    // joined (e.g. "id" or "orgId id"). Each qualifying op is one type-level resolver.
    target.entityResolvers.push({
      keyFields: pathParams.map((p) => p.name).join(' '),
      path: op.operation.path,
      verb: op.verb,
      source: 'api',
    });
  }
}
