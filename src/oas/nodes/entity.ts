import {
  QueuedNode,
  Body,
  IType,
  Obj,
  Op,
  Param,
  Prop,
  PropArray,
  PropEntityLink,
  PropObj,
  Res,
  Scalar,
  T,
  Union,
} from './internal.js';
import type { NameValue, SecurityPlan } from '../io/security.js';
import { Naming } from '../utils/naming.js';
import { OasContext } from '../oasContext.js';
import { OasGen } from '../oasGen.js';
import { ExpandedSelection } from '../utils/expandedSelection.js';
import { warn } from '../log/trace.js';

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
  // HTTP verb of the qualifying op, GET or POST.
  verb: string;
  // POST only: the request body property that carries the key, e.g. "departmentId".
  bodyProp?: string;
  // POST only: the response property the keyed object sits under, e.g. "results".
  envelopeField?: string;
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

// Case/separator-insensitive compare key: lowercases, strips `_`/`-`.
function normaliseForCompare(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, '');
}

// `typeName` is `Obj.name` through `Naming.getRefName` (strips a `$ref`'s `#/components/…/`
// prefix; raw already for a synthesized name), e.g. (entity-param-alias) "Pet" + "petId" -> true.
function isIdAlias(typeName: string, paramName: string): boolean {
  return `${normaliseForCompare(typeName)}id` === normaliseForCompare(paramName);
}

// #191: an entity is only a link target when its own key literally names itself "id" or aliases
// to it via isIdAlias -- a type keyed on something else (e.g. User on username) never is.
function isIdKey(refName: string, keyField: Prop): boolean {
  return keyField.name === 'id' || isIdAlias(refName, keyField.name);
}

// Literal name match wins; failing that, a sole path param named `<TypeName>Id` aliases to `id`.
// e.g. (entity-param-alias) `/pet/{petId}` -> `Pet.id`; two path params keeps neither aliased.
function findKeyField(obj: Obj, param: Param, pathParams: Param[], selected: Prop[]): Prop | undefined {
  const literal = obj.props.get(param.name);
  if (literal !== undefined && T.isPropScalar(literal) && selected.includes(literal)) {
    return literal;
  }

  if (pathParams.length !== 1 || !isIdAlias(Naming.getRefName(obj.name), param.name)) {
    return undefined;
  }

  const aliased = obj.props.get('id');
  return aliased !== undefined && T.isPropScalar(aliased) && selected.includes(aliased) ? aliased : undefined;
}

// A stand-in for a path param carrying only the name findKeyField reads.
function paramFor(name: string): Param {
  return { name } as unknown as Param;
}

// Whether an op is even worth testing as a POST resolver: a read op (per the overrides file),
// with a plain JSON body and nothing else required to fill in.
//   e.g. (ashby) POST /job.info, body { id }, no other required param -> worth testing
function isPostCandidateOp(op: IType & Op, context: OasContext): boolean {
  if (!T.isQueryType(op, context) || !op.body || op.body.mediaType.toLowerCase() !== 'application/json') {
    return false;
  }
  return op.params.every((param) => !param.required);
}

// A node's own single object-typed property, when every other property is a scalar or a list of
// scalars -- the shape an id-keyed response sits inside.
//   e.g. (ashby) JobInfoSuccessResponse { success: bool, results: Job } -> { obj: Job, envelopeField: "results" }
function envelopeCandidate(node: IType): { obj: Obj; envelopeField: string } | undefined {
  if (!(node instanceof Obj)) {
    return undefined;
  }
  const objectProps = Array.from(node.props.values()).filter(
    (prop): prop is PropObj => prop instanceof PropObj && prop.obj instanceof Obj,
  );
  const rest = Array.from(node.props.values()).filter((prop) => !objectProps.includes(prop as PropObj));
  const wrapped = rest.every(
    (prop) => T.isPropScalar(prop) || (prop instanceof PropArray && prop.items instanceof Scalar),
  );
  return objectProps.length === 1 && wrapped
    ? { obj: objectProps[0].obj as Obj, envelopeField: objectProps[0].name }
    : undefined;
}

// A POST op's response after one Res layer: the object itself, one wrapped property, or a union
// where exactly one member resolves as a wrapped object.
//   e.g. (ashby) oneOf [JobInfoSuccessResponse, ErrorResponse] -> only the success branch wraps one object
function unwrapPostResult(resultType: IType | undefined): { obj: Obj; envelopeField?: string } | undefined {
  let node: IType | undefined = resultType;
  if (node instanceof Res) {
    node = node.response;
  }
  if (node instanceof Union) {
    const candidates = node.children
      .map((member) => envelopeCandidate(member))
      .filter((candidate) => candidate !== undefined);
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  if (!node) {
    return undefined;
  }
  return envelopeCandidate(node) ?? (node instanceof Obj ? { obj: node } : undefined);
}

// The one body property resolving against the response object's key, tried one at a time so
// findKeyField's alias branch stays reachable; any other property left over must be optional.
//   e.g. (ashby) job.info's required id resolves, optional expand/includeUnpublishedJobPostingsIds don't
function findBodyKeyField(obj: Obj, body: Body, selected: Prop[]): { field: Prop; bodyProp: string } | undefined {
  if (!(body.payload instanceof Obj)) {
    return undefined;
  }
  const matches: { field: Prop; bodyProp: string }[] = [];
  const unresolved: Prop[] = [];
  for (const prop of body.payload.props.values()) {
    const param = paramFor(prop.name);
    const field = findKeyField(obj, param, [param], selected);
    if (field) {
      matches.push({ field, bodyProp: prop.name });
    } else {
      unresolved.push(prop);
    }
  }
  return matches.length === 1 && !unresolved.some((prop) => prop.required) ? matches[0] : undefined;
}

// What a qualifying op needs recorded before it becomes an EntityResolver.
interface ResolverCandidate {
  obj: Obj;
  keyFields: Prop[];
  path: string;
  bodyProp?: string;
  envelopeField?: string;
}

// Today's GET-by-key rule, unchanged: every path param resolves to a selected scalar field.
//   e.g. (entity-resolver) GET /widgets/{id} -> Widget @key(fields: "id")
function getResolverCandidate(
  op: IType & Op,
  selection: ExpandedSelection,
  keep: boolean,
): ResolverCandidate | undefined {
  const obj = unwrapToObj(op.resultType);
  if (!obj) {
    return undefined;
  }

  const pathParams = op.params.filter((p) => p.parameter.in && p.parameter.in.toLowerCase() === 'path');
  if (pathParams.length === 0) {
    return undefined;
  }

  const selected = obj.selectedProps(selection, keep, selection.writtenPath(obj));
  const keyFields = pathParams.map((p) => findKeyField(obj, p, pathParams, selected));
  if (!keyFields.every((field): field is Prop => field !== undefined)) {
    return undefined;
  }

  // Composite key: the matched properties' own names, not the OAS path-param names (write
  // sites look these up literally). Path tokens follow suit, e.g. (entity-param-alias)
  // `{petId}` -> `{id}`, so `$this` substitution (obj.ts) stays a plain rename.
  let path = op.operation.path;
  pathParams.forEach((p, i) => {
    const fieldName = keyFields[i].name;
    if (fieldName !== p.name) {
      path = path.replace(`{${p.name}}`, `{${fieldName}}`);
    }
  });

  return { obj, keyFields, path };
}

// Rule 1/2/3 for a POST candidate: a read op sending one JSON-body key that resolves against a
// response that is (or is wrapped one level around) the keyed object.
//   e.g. (ashby) POST /job.info, body { id } -> Job, wrapped under "results"
function postResolverCandidate(
  op: IType & Op,
  context: OasContext,
  selection: ExpandedSelection,
  keep: boolean,
): ResolverCandidate | undefined {
  if (!isPostCandidateOp(op, context)) {
    return undefined;
  }

  const unwrapped = unwrapPostResult(op.resultType);
  if (!unwrapped) {
    return undefined;
  }

  const selected = unwrapped.obj.selectedProps(selection, keep, selection.writtenPath(unwrapped.obj));
  const match = findBodyKeyField(unwrapped.obj, op.body!, selected);
  if (!match) {
    return undefined;
  }

  return {
    obj: unwrapped.obj,
    keyFields: [match.field],
    path: op.operation.path,
    bodyProp: match.bodyProp,
    envelopeField: unwrapped.envelopeField,
  };
}

// Discovers GET-by-key and read-only POST-by-key (#224) operations and records them as
// type-level entity resolvers (@connect/$this on the type), replacing prior resolvers each run.
//   e.g. (ashby) POST /job.info, body { id } -> type Job @key(fields: "id") @connect(...)
export function inferEntityResolvers(
  context: OasContext,
  gen: OasGen,
  types: Map<string, IType>,
  selection: ExpandedSelection,
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
  const selectionRoots = new Set<string>(selection.entries.map((s) => s.split(Naming.PATH_SEPARATOR)[0]));

  for (const op of gen.paths.values()) {
    if (!T.isOp(op) || !selectionRoots.has(op.id)) {
      continue;
    }

    const candidate =
      op.verb === 'GET'
        ? getResolverCandidate(op, selection, keep)
        : op.verb === 'POST'
          ? postResolverCandidate(op, context, selection, keep)
          : undefined;
    if (!candidate) {
      continue;
    }

    // Attach to the one generated type instance the writer will emit (same id).
    const target = types.get(candidate.obj.id);
    if (!(target instanceof Obj)) {
      continue;
    }

    // Auth must match the op this was inferred from: a per-op header or apiKey-in-query, when
    // set, travels with the resolver too -- uniform-mode @source auth alone covers the rest.
    const { header: headerAuth, query: queryAuth } = security?.forOp(op) ?? { header: null, query: null };

    target.entityResolvers.push({
      keyFields: candidate.keyFields.map((field) => field.name).join(' '),
      path: candidate.path,
      verb: op.verb,
      bodyProp: candidate.bodyProp,
      envelopeField: candidate.envelopeField,
      source: 'api',
      headerAuth,
      queryAuth,
    });
  }
}

// Holds a GET that fetches `target` from its key alone, as findByIdTarget finds it. #249
//   e.g. (entity-link-overrides) get:/sobjects/User/{Id} -> { target: User, keyProp: Id, param: Id }
interface ByIdTarget {
  op: IType & Op;
  target: Obj;
  keyProp: Prop;
  param: Param;
}

// A candidate link source: a root GET-by-id op ending in its one path param, resolving to an
// id-keyed R1-resolved type (its own key is "id" or a "<TypeName>Id" alias). #191
interface EntityLinkCandidate {
  opId: string;
  target: Obj;
  targetKeyProp: Prop;
  fieldName: string;
}

// #191: key-only reference fields, id-keyed entities only. A selected output type carrying a
// scalar field named "<TypeName>Id" (or "id") gets a key-only reference to that entity, e.g.
// (entity-link) Song.album_id -> Song.album: Album. Input types never host a link.
export function inferEntityLinks(
  context: OasContext,
  gen: OasGen,
  types: Map<string, IType>,
  selection: ExpandedSelection,
): void {
  for (const type of types.values()) {
    if (type instanceof Obj) {
      type.entityLinkProps = [];
    }
  }

  const links = context.generateOptions.overrides?.$links ?? {};
  if (!context.generateOptions.inferEntityResolvers) {
    if (Object.keys(links).length > 0) {
      warn(null, '[entity-link]', '"$links" needs --infer-entity-resolvers; no link written');
    }
    return;
  }

  const keep = context.generateOptions.keepFieldNames === true;
  const selectionRoots = new Set<string>(selection.entries.map((s) => s.split(Naming.PATH_SEPARATOR)[0]));

  // Lists every GET that fetches an entity from its key alone, in op order so a "$links" target
  // picks the same op on every run. e.g. (entity-link-overrides) get:/sobjects/User/{Id} -> User by Id
  const byIdTargets = Array.from(gen.paths.values())
    .map((op) => findByIdTarget(op, types, selection, keep, selectionRoots))
    .filter((byId): byId is ByIdTarget => byId !== undefined)
    .sort((a, b) => a.op.id.localeCompare(b.op.id));

  // Places each "$links" entry with one target before inference, so the entry wins its field and
  // its name. A target list writes no link: Prop adds its note instead. see docs/FIXED.md #249
  //   e.g. "Account.OwnerId": { "target": "User", "name": "Owner" } -> Account.owner: User
  const linkedFields = new Set(Object.keys(links));
  for (const [key, link] of Object.entries(links)) {
    const [hostName, fieldName] = key.split('.');
    if (Array.isArray(link.target)) {
      continue;
    }
    const targetName = link.target;
    const skip = (reason: string) => warn(null, '[entity-link]', `"$links" "${key}": ${reason}`);

    if (targetName === hostName) {
      skip('self-link left as id: the composer rejects a type inside its own selection');
      continue;
    }
    const host = Array.from(types.values()).find(
      (type): type is Obj => type instanceof Obj && type.kind !== 'input' && Naming.getRefName(type.name) === hostName,
    );
    if (!host) {
      skip(`no selected output type ${hostName}`);
      continue;
    }
    const sourceProp = host
      .selectedProps(selection, keep, selection.writtenPath(host))
      .find((prop) => T.isPropScalar(prop) && prop.name === fieldName);
    if (!sourceProp) {
      skip(`${hostName} has no selected field ${fieldName}`);
      continue;
    }
    const byId = byIdTargets.find(({ target }) => Naming.getRefName(target.name) === targetName);
    if (!byId) {
      skip(`no by-id operation for ${targetName} that takes only its key`);
      continue;
    }
    const linkName = Naming.sanitiseField(link.name ?? targetName, keep);
    // Compares GraphQL names: `Account.Name` and a link named "Name" would both write `name`.
    const writtenNames = [...host.props.values(), ...host.entityLinkProps].map((prop) =>
      host.findFieldName(prop, keep),
    );
    if (writtenNames.includes(linkName)) {
      skip(`${hostName} already has a field ${linkName}`);
      continue;
    }
    // Names the field that holds the host from the node right above it, built where it sits: the
    // host itself is built once, so its own parents name its first route, not this one. #242
    //   e.g. (entity-link-overrides) Account.Users' list holds User -> "Account.users"
    const heldByValue = Array.from(descendants(context, selection, byId.target, false));
    if (heldByValue.some((node) => node !== byId.target && node.id === host.id)) {
      const wrapper = heldByValue.find((node) => node.children.some((child) => child.id === host.id));
      const holder = wrapper
        ?.ancestors()
        .reverse()
        .find((node) => node instanceof Prop);
      const holderName = holder
        ? `${Naming.getRefName(holder.parent!.name)}.${Naming.sanitiseField(holder.name, keep)}`
        : targetName;
      skip(
        `${holderName} nests ${hostName}, so ${hostName}.${linkName} would put ${targetName} inside its own selection; left as id`,
      );
      continue;
    }
    host.entityLinkProps.push(new PropEntityLink(host, linkName, byId.target, byId.keyProp, sourceProp));
  }

  const candidates: EntityLinkCandidate[] = [];

  for (const { op, target, keyProp: targetKeyProp, param } of byIdTargets) {
    if (!isIdKey(Naming.getRefName(target.name), targetKeyProp)) {
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
    const refName = Naming.getRefName(target.name);

    for (const host of types.values()) {
      if (!(host instanceof Obj) || host === target || host.kind === 'input') {
        continue;
      }

      // #168 twin case: Loop carries both beat_Id (optional) and beat_id (required) -- both name
      // Beat, so prefer the one spelled exactly like the target's own key, Loop.beat_id.
      // Leaves out a field a "$links" entry names: the entry is its answer, even when skipped. #249
      const idAliases = host
        .selectedProps(selection, keep, selection.writtenPath(host))
        .filter((prop) => T.isPropScalar(prop) && isIdAlias(refName, prop.name))
        .filter((prop) => !linkedFields.has(`${Naming.getRefName(host.name)}.${prop.name}`));
      const sourceProp = idAliases.find((prop) => prop.name === targetKeyProp.name) ?? idAliases[0];
      if (!sourceProp) {
        continue;
      }

      const fieldTaken = host.props.has(fieldName) || host.entityLinkProps.some((p) => p.name === fieldName);
      if (fieldTaken || reaches(context, selection, target, host)) {
        continue;
      }

      host.entityLinkProps.push(new PropEntityLink(host, fieldName, target, targetKeyProp, sourceProp));
    }
  }

  // Shares the links above with every other copy of an inline response type, which is built once per
  // op (a $ref type is one node, #242), so each op writes the same stub,
  // e.g. (entity-link) GET and PATCH /cards/{card_ref} both write `thing: { id: thingId }`. #196
  const linkedHosts = new Map<string, Obj>();
  for (const type of types.values()) {
    if (type instanceof Obj && type.entityLinkProps.length > 0) {
      linkedHosts.set(type.id, type);
    }
  }
  if (linkedHosts.size === 0) {
    return;
  }
  for (const op of gen.paths.values()) {
    if (!T.isOp(op) || !selectionRoots.has(op.id) || !op.resultType) {
      continue;
    }
    for (const node of descendants(context, selection, op.resultType)) {
      const host = linkedHosts.get(node.id);
      if (host && node !== host && node instanceof Obj) {
        node.entityLinkProps = host.entityLinkProps;
      }
    }
  }
}

// Every node reachable from `from` via dependencies(), the same idiom
// typesCollector.collectReachable uses. e.g. (entity-link) from Album, reaches Song via Song.album. #161
// Stays out of link stubs when `followLinks` is false, finding only what `from` holds by value. #249
//   e.g. (entity-link-overrides) from Account, reaches User through Account.Users, not Account.owner
function descendants(context: OasContext, selection: ExpandedSelection, from: IType, followLinks = true): Set<IType> {
  const visited = new Set<IType>();
  const queue: QueuedNode[] = [{ node: from, path: selection.writtenPath(from) }];
  while (queue.length > 0) {
    const { node, path } = queue.pop()!;
    if (visited.has(node) || (!followLinks && node instanceof PropEntityLink)) {
      continue;
    }
    visited.add(node);
    queue.push(...node.findDependencies(context, selection, path));
  }
  return visited;
}

// Returns the entity a GET fetches from its key alone, with the key field its resolver uses: one
// path param that ends the path, no other required param, a result that is an entity. Inference
// and "$links" both call it. see docs/FIXED.md #249
//   e.g. (entity-link-overrides) get:/sobjects/User/{Id} -> User by Id; Queue's required `mode` -> none
function findByIdTarget(
  op: IType,
  types: Map<string, IType>,
  selection: ExpandedSelection,
  keep: boolean,
  selectionRoots: Set<string>,
): ByIdTarget | undefined {
  if (!T.isOp(op) || op.verb !== 'GET' || !selectionRoots.has(op.id)) {
    return undefined;
  }

  const pathParams = op.params.filter((p) => p.parameter.in && p.parameter.in.toLowerCase() === 'path');
  if (pathParams.length !== 1 || op.params.some((p) => p !== pathParams[0] && p.required)) {
    return undefined;
  }

  const param = pathParams[0];
  if (op.operation.path.split('/').pop() !== `{${param.name}}`) {
    return undefined;
  }

  const obj = unwrapToObj(op.resultType);
  const target = obj && types.get(obj.id);
  if (!(target instanceof Obj) || target.entityResolvers.length === 0) {
    return undefined;
  }

  const keyProp = findKeyField(
    target,
    param,
    pathParams,
    target.selectedProps(selection, keep, selection.writtenPath(target)),
  );
  const resolver = keyProp && target.entityResolvers.find((r) => r.keyFields === keyProp.name);
  return resolver && keyProp ? { op, target, keyProp, param } : undefined;
}

// Whether `from` can already reach `to` -- blocks a link that would close a cycle.
// e.g. (entity-link) albums<->songs: the second direction is skipped once the first links.
function reaches(context: OasContext, selection: ExpandedSelection, from: IType, to: IType): boolean {
  return descendants(context, selection, from).has(to);
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
