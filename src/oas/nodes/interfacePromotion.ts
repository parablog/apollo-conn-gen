import { Composed, IType, Obj, Op, Res, Union } from './internal.js';
import { OasContext } from '../oasContext.js';
import { OasGen } from '../oasGen.js';
import { Naming } from '../utils/naming.js';

/**
 * R2 (Scenario B): promote a discriminated `oneOf` whose members all share one `allOf` base into a
 * GraphQL `interface`. Instead of `union X = A | B`, emit:
 *
 *   interface Base { <base fields> }
 *   type A implements Base { <base fields> <A fields> }
 *   type B implements Base { <base fields> <B fields> }
 *   field: Base @connect(... selection: """ ...<discr>->match([...]) """)
 *
 * The `->match` selection is identical to the union form (rover-verified to compose for interfaces),
 * so this pass only does **type modeling**; selection emission is untouched.
 *
 * Runs as a POST-COLLECT pass over the collected `types` map (the map the writer emits), mirroring
 * {@link inferEntityResolvers}. It must run post-collect because the canonical, about-to-be-emitted
 * node instances only exist there — `context.types` is a name-existence set (stores `undefined`), and
 * the shared base is deleted from `types` during consolidation, surviving only as a child of each
 * member (so it is re-sourced from a member and re-inserted here).
 *
 * Promotion is id-neutral: it sets flags (`Obj.emitAsInterface`, `Composed.implementsInterface`,
 * `Union.interfaceBaseRef`) and never mutates `kind` (which is embedded in node ids).
 *
 * Gating mirrors the committed union slice: `consolidateUnions === false` + a discriminator. (Wiring
 * this to the spec version — connect >= v0.4 — is a separate roadmap follow-up.) A candidate union is
 * promoted only when ALL hold:
 *  1. every member is an allOf {@link Composed};
 *  2. exactly one `$ref` is common to every member's `allOf` (empty or >1 -> stay a union);
 *  3. the base is not used as a concrete type anywhere else (else promoting it would turn an
 *     unrelated field into an interface with no `__typename`) -> stay a union, logged.
 */
export function promoteInterfaces(
  context: OasContext,
  gen: OasGen,
  types: Map<string, IType>,
  _selection: string[],
): void {
  if (context.generateOptions.consolidateUnions) {
    return; // interfaces only on the real-abstract-types path
  }

  for (const union of candidateUnions(gen)) {
    if (!union.discriminator) continue;

    const members = union.children;
    if (members.length === 0) continue;
    // Rule 1: every member is an allOf Composed.
    if (!members.every((m) => m instanceof Composed && Array.isArray((m as Composed).schema.allOf))) {
      continue;
    }
    const composedMembers = members as Composed[];

    // Rule 2: exactly one $ref common to every member's allOf.
    const refSets = composedMembers.map((m) => new Set(allOfRefs(m)));
    const common = [...refSets[0]].filter((ref) => refSets.every((s) => s.has(ref)));
    if (common.length !== 1) {
      continue;
    }
    const baseRef = common[0];

    // Rule 3: base must be private to this oneOf (not used concretely elsewhere).
    if (baseUsedExternally(context, gen, types, baseRef, composedMembers)) {
      continue;
    }

    // Source the base node from a surviving member (it was deleted from `types` during
    // consolidation but is never detached from its member). All members' copies are
    // field-identical (same $ref schema), so the first is fine.
    const base = composedMembers[0].children.find((c) => c.name === baseRef);
    if (!(base instanceof Obj)) {
      console.warn(`[interface] could not source base node for ${baseRef}; leaving ${union.name} a union.`);
      continue;
    }

    // Promote (id-neutral): flag the base as an interface and insert it into the emitted map;
    // tag each member to implement it; redirect/suppress the union.
    base.emitAsInterface = true;
    types.set(base.id, base);

    const interfaceName = Naming.genTypeName(baseRef);
    for (const member of composedMembers) {
      const emitted = types.get(member.id);
      if (emitted instanceof Composed) {
        emitted.implementsInterface = interfaceName;
      }
    }

    union.interfaceBaseRef = baseRef;
  }
}

/** Union instances reachable as a GET/op response (the ones whose return type the writer emits). */
function candidateUnions(gen: OasGen): Union[] {
  const out: Union[] = [];
  for (const type of gen.paths.values()) {
    const op = type as unknown as Op;
    let node: IType | undefined = op.resultType;
    if (node instanceof Res) node = node.response;
    if (node instanceof Union) out.push(node);
  }
  return out;
}

/** The `$ref` strings of a Composed's `allOf` entries (inline, non-$ref entries are dropped). */
function allOfRefs(comp: Composed): string[] {
  const allOf = (comp.schema.allOf ?? []) as Array<{ $ref?: string }>;
  return allOf.map((s) => s.$ref).filter((r): r is string => Boolean(r));
}

/**
 * True when `baseRef` is referenced as a concrete type outside the promoted union's members.
 * Structural scan is authoritative (catches a field/op that returns the base directly, or another
 * type extending it); the raw refCount is a cross-check that, when it disagrees, is logged. (refCount
 * is the raw `lookupRef` tally here — `decRefCount` only runs on the consolidate path — but it can
 * over-count via repeated ref resolution, so it does not by itself block promotion.)
 */
function baseUsedExternally(
  context: OasContext,
  gen: OasGen,
  types: Map<string, IType>,
  baseRef: string,
  members: Composed[],
): boolean {
  const memberIds = new Set(members.map((m) => m.id));
  let structural = false;
  let reason = '';

  // (a) any op whose result type unwraps directly to the base.
  for (const type of gen.paths.values()) {
    const op = type as unknown as Op;
    let node: IType | undefined = op.resultType;
    if (node instanceof Res) node = node.response;
    if (node && (node instanceof Obj || node instanceof Composed) && node.name === baseRef) {
      structural = true;
      reason = `returned directly by ${type.id}`;
      break;
    }
  }

  // (b) any non-member Composed that also extends the base.
  if (!structural) {
    for (const type of types.values()) {
      if (type instanceof Composed && !memberIds.has(type.id) && allOfRefs(type).includes(baseRef)) {
        structural = true;
        reason = `also extended by ${type.id}`;
        break;
      }
    }
  }

  // refCount cross-check (advisory).
  const internalRefs = members.reduce((n, m) => n + allOfRefs(m).filter((r) => r === baseRef).length, 0);
  const rc = context.refCount.get(baseRef) ?? 0;
  const refCountExternal = rc > internalRefs;

  if (structural) {
    console.warn(
      `[interface] not promoting ${baseRef} to an interface — used as a concrete type (${reason}); ` +
        `field stays a union. (refCount=${rc}, internal=${internalRefs})`,
    );
    return true;
  }
  if (refCountExternal) {
    // Structural scan saw nothing but the tally is higher than the member references — surface it,
    // but trust the structural scan (refCount can over-count). Promotion proceeds.
    console.warn(
      `[interface] refCount for ${baseRef} (${rc}) exceeds member references (${internalRefs}) but no ` +
        `concrete external use was found structurally; promoting anyway.`,
    );
  }
  return false;
}
