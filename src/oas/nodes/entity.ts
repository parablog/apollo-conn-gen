import { IType, Obj, Prop, PropEntityLink, Res, T } from './internal.js';
import type { NameValue, SecurityPlan } from '../io/security.js';
import { Naming } from '../utils/naming.js';
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
  /** The qualifying op's per-@connect auth header (per-op security mode only), if any. */
  headerAuth?: NameValue | null;
  /** The qualifying op's apiKey-in-query auth (any mode — @source has no queryParams), if any. */
  queryAuth?: NameValue | null;
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
  security?: SecurityPlan,
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

  const keep = context.generateOptions.keepFieldNames === true;
  // The root id of every selected path (matches how the writers pick query fields).
  const selectionRoots = new Set<string>(selection.map((s) => s.split(Naming.PATH_SEPARATOR)[0]));

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

    const selected = obj.selectedProps(selection, keep);
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

    // The resolver must authenticate exactly like the op it was inferred from: in uniform
    // mode the @source header already covers it, but a per-op header or an apiKey-in-query
    // credential lives on each @connect — without it, every router-side entity fetch to a
    // protected endpoint fails. Resolved here because the plan lives with the writer; the
    // writer resolves the same op again for its Query field, so dropped-scheme warnings can
    // repeat for an op that is both selected and a resolver.
    const { header: headerAuth, query: queryAuth } = security?.forOp(op) ?? { header: null, query: null };

    // Composite key for this resolver: path-param names in path order, single-space
    // joined (e.g. "id" or "orgId id"). Each qualifying op is one type-level resolver.
    target.entityResolvers.push({
      keyFields: pathParams.map((p) => p.name).join(' '),
      path: op.operation.path,
      verb: op.verb,
      source: 'api',
      headerAuth,
      queryAuth,
    });
  }
}

// A candidate link source: a root GET-by-id op ending in its one path param, resolving to an
// R1-resolved type. e.g. (entity-link) GET /albums/{album_id} -> Album. #161
interface EntityLinkCandidate {
  opId: string;
  target: Obj;
  targetKeyProp: Prop;
  fieldName: string;
}

// #161: key-only reference fields. A root GET ending in one path param, resolving to an
// R1-resolved type, seeds a field on any other selected type carrying that same scalar name.
// e.g. (entity-link) Song.album_id -> Song.album: Album, coupled to --infer-entity-resolvers.
export function inferEntityLinks(
  context: OasContext,
  gen: OasGen,
  types: Map<string, IType>,
  selection: string[],
): void {
  for (const type of types.values()) {
    if (type instanceof Obj) {
      type.entityLinkProps = [];
    }
  }

  if (!context.generateOptions.inferEntityResolvers) {
    return;
  }

  const keep = context.generateOptions.keepFieldNames === true;
  const selectionRoots = new Set<string>(selection.map((s) => s.split(Naming.PATH_SEPARATOR)[0]));

  const candidates: EntityLinkCandidate[] = [];

  for (const op of gen.paths.values()) {
    if (!T.isOp(op) || op.verb !== 'GET' || !selectionRoots.has(op.id)) {
      continue;
    }

    const pathParams = op.params.filter((p) => p.parameter.in && p.parameter.in.toLowerCase() === 'path');
    if (pathParams.length !== 1 || op.params.some((p) => p !== pathParams[0] && p.required)) {
      continue;
    }

    const param = pathParams[0];
    if (op.operation.path.split('/').pop() !== `{${param.name}}`) {
      continue;
    }

    const obj = unwrapToObj(op.resultType);
    const target = obj && types.get(obj.id);
    if (!(target instanceof Obj) || target.entityResolvers.length === 0) {
      continue;
    }

    const resolver = target.entityResolvers.find((r) => r.keyFields === param.name);
    const targetKeyProp = resolver && target.props.get(param.name);
    if (!targetKeyProp) {
      continue;
    }

    const staticSegments = op.operation.path.split('/').filter((s) => s && s !== `{${param.name}}`);
    const lastStaticSegment = staticSegments[staticSegments.length - 1];
    if (!lastStaticSegment) {
      continue;
    }

    candidates.push({ opId: op.id, target, targetKeyProp, fieldName: singularize(lastStaticSegment) });
  }

  candidates.sort((a, b) => a.opId.localeCompare(b.opId));

  for (const { target, targetKeyProp, fieldName } of candidates) {
    for (const host of types.values()) {
      if (!(host instanceof Obj) || host === target) {
        continue;
      }

      const sourceProp = host.props.get(targetKeyProp.name);
      if (!sourceProp || !T.isPropScalar(sourceProp) || !host.selectedProps(selection, keep).includes(sourceProp)) {
        continue;
      }

      const fieldTaken = host.props.has(fieldName) || host.entityLinkProps.some((p) => p.name === fieldName);
      if (fieldTaken || reaches(context, selection, target, host)) {
        continue;
      }

      host.entityLinkProps.push(new PropEntityLink(host, fieldName, target, targetKeyProp, sourceProp));
    }
  }
}

// Whether `from` can already reach `to` via dependencies(), the same idiom
// typesCollector.collectReachable uses -- blocks a link that would close a cycle. #161
// e.g. (entity-link) albums<->songs: the second direction is skipped once the first links.
function reaches(context: OasContext, selection: string[], from: IType, to: IType): boolean {
  const visited = new Set<IType>();
  const queue: IType[] = [from];
  while (queue.length > 0) {
    const node = queue.pop()!;
    if (node === to) {
      return true;
    }
    if (visited.has(node)) {
      continue;
    }
    visited.add(node);
    queue.push(...node.dependencies(context, selection));
  }
  return false;
}

// A plain regex plural-to-singular pass (irregular plurals unhandled) for turning a path's last
// static segment into a field name. e.g. "albums" -> "album", "categories" -> "category". #161
function singularize(word: string): string {
  if (/ies$/i.test(word) && word.length > 3) {
    return word.slice(0, -3) + 'y';
  }
  if (/(?:s|x|z|ch|sh)es$/i.test(word)) {
    return word.slice(0, -2);
  }
  if (/s$/i.test(word) && !/ss$/i.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}
