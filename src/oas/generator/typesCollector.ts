import _ from 'lodash';
import { Composed } from '../nodes/comp.js';
import {
  QueuedNode,
  Arr,
  En,
  IType,
  // aliased: this file builds plenty of real `Map`s, and the node class would shadow the built-in
  Map as MapNode,
  Obj,
  Op,
  Prop,
  PropArray,
  PropCircRef,
  PropComp,
  PropEn,
  PropMap,
  PropObj,
  Res,
  Scalar,
  T,
  Union,
} from '../nodes/internal.js';
import { OasGen } from '../oasGen.js';
import { trace, warn } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Naming } from '../utils/naming.js';
import { SelectionPath } from '../utils/selectionPath.js';
import { ExpandedSelection, LeafTarget } from '../utils/expandedSelection.js';
import { EnvelopeContext, envelopeContext, findPayload, isEnvelopeNode } from '../utils/payload.js';

// Whether every route to a union reached it as the op's response, and whether every one reached it
// as a field, list item or map value. #121 #242
//   e.g. (per-op-green-whole-red.yaml) Media: { topLevel: false, valueOrItem: false }
interface UnionRoutes {
  topLevel: boolean;
  valueOrItem: boolean;
}

// How the loop walk reached a node: the op walked, the written type whose field or member it came
// through, and the nearest field on the way (none for a member or a map's value); for a union member
// left out, that member. #242
//   e.g. (cycle-on-some-routes.yaml) Content from Space: { opId: get:/graph, writer: Space, field: homepage }
interface LoopEdge {
  opId?: string;
  writer?: IType;
  field?: Prop;
  member?: IType;
}

// Holds a written type on the loop walk's stack, what it counts as (findLoopIdentity), and how the
// walk reached it. #242
//   e.g. (cycle-on-some-routes.yaml) { node: Space, identity: Space, edge: { writer: Content, field: space } }
interface LoopWalkStep {
  node: IType;
  identity: IType | string;
  edge: LoopEdge;
}

// Holds the types a reachability pass reached, and the routes it reached each on, in visit order. #26 #242
//   e.g. (shared-component-two-ops.yaml) Item -> [get:/a>res:r>obj:type:#/c/s/Item, get:/b>res:r>obj:type:#/c/s/Item]
interface ReachedTypes {
  reachable: Set<IType>;
  routes: Map<IType, string[]>;
}

export class TypesCollector {
  types: Map<string, IType> = new Map();
  expanded: ExpandedSelection = new ExpandedSelection([]);

  constructor(private gen: OasGen) {}

  public collect(selection: string[]): void {
    const context = this.gen.getContext();
    // Starts from this generation's selection only, with no leftovers from an earlier one. see docs/FIXED.md #89
    context.propOverrides.clear();
    const pendingTypes: Map<string, IType> = new Map();
    const pathsCollector = new PathsCollector(this.gen);
    const expanded = pathsCollector.collectExpandedPaths(selection);

    // Expands each leaf the `>**` walks found, in walk order, then queues its types, as the string
    // loop below did for one path per leaf; that loop now reads only the explicit entries. A node a
    // walk skipped, with a leaf below it, queues the types on its route the same way. #242
    //   e.g. (nested-choice-plain-and-list.yaml) the leaf `flat` is expanded here, building its union
    for (const { node, chain, leaf } of expanded.reached) {
      if (leaf) {
        this.gen.expand(node);
      }
      this.enqueueOwnerAndContainerAncestors(pendingTypes, expanded, node, chain);
    }

    for (const path of expanded.entries) {
      // Skips a `>**` root: its leaves went through the loop above.
      if (path.endsWith('>**')) {
        continue;
      }
      let collection = Array.from(this.gen.paths.values());
      let current: IType | undefined;
      let last: IType | undefined;
      let hitWildcard = false;
      // Collects the nodes the entry resolves to, op first: the route, since a shared node has no one parent
      const chain: IType[] = [];

      let i = 0;
      const parts = path.split(Naming.PATH_SEPARATOR);
      do {
        const part = Naming.expandRef(parts[i]);
        if (part === '*') {
          hitWildcard = true;
          // remove the current path from the expanded array
          expanded.entries = expanded.entries.filter((s) => s !== path);

          if (current && current instanceof Composed) {
            current!.consolidate();
          }

          // add all the props from the current node and exit loop
          const currentPath = Naming.pathUnder('', ...chain.map((node) => node.id));
          current?.props.forEach((child) => {
            if (T.isLeaf(child)) {
              expanded.entries.push(current!.propPath(child, currentPath));
            }
          });
          break;
        }

        current = SelectionPath.resolveSegment(context, last, collection, part);
        if (!current) {
          const tree = T.print(last!.ancestors()[0]);

          // let's collect the possible paths so we don't have to debug
          throw new Error(
            'Could not find type: ' + part + ' from ' + path + '\nlast:\n' + last?.pathToRoot() + '\ntree: ' + tree,
          );
        }

        // make sure we expand it before we move on to the next part
        this.gen.expand(current);
        // Skips a saved field that resolves to its union: it is not a step of its own on the route
        if (current !== last) {
          chain.push(current);
        }
        last = current;

        collection = Array.from(current!.children.values()) || Array.from(current!.props.values()) || [];
        i++;
      } while (i < parts.length);

      // #135: a saved selection can still name a field by an old, renamed name — e.g. digitalocean.yaml's
      // ActiveDeployment.cause, renamed to inlinev2AppsByAppIdDeploymentsResponseActiveDeployment after
      // browsing /v2/apps first (test_72). The walk above finds the field anyway; keep `expanded` in sync.
      const resolvedPath = Naming.pathUnder('', ...chain.map((node) => node.id));
      if (!hitWildcard && current && resolvedPath !== path) {
        const idx = expanded.entries.indexOf(path);
        if (idx !== -1) expanded.entries[idx] = resolvedPath;

        // A saved path from before this union became a mixed value names a field directly on it;
        // collect every leaf field of its object members instead, nested ones included.
        //   e.g. (confluence) labels' object member holds results: [Label] -> Label's id/label/name/prefix
        if (current instanceof Union) {
          const union = current;
          const shape = union.analyzeMixedValue(context, true, chain[chain.length - 2]);
          if (shape) {
            const op = chain[0] as IType & Op;
            const memberLeaves = new Set<string>();
            const memberLeafTarget: LeafTarget = {
              beginWalk: () => {},
              add: (leaf, ancestors) => memberLeaves.add(pathsCollector.pathFromWalk(resolvedPath, ancestors, leaf)),
              addForOp: (_opId, leaf, ancestors) =>
                memberLeaves.add(pathsCollector.pathFromWalk(resolvedPath, ancestors, leaf)),
              exclude: () => {},
              markIfWalked: () => {},
              hasLeafUnder: (side) => {
                const sidePath = pathsCollector.pathFromWalk(resolvedPath, [], side);
                return Array.from(memberLeaves).some((p) => p.startsWith(sidePath));
              },
            };
            shape.objectMemberIndexes.forEach((i) => pathsCollector.collectLeafPaths(union.children[i], op, memberLeafTarget));
            memberLeaves.forEach((p) => {
              if (!expanded.entries.includes(p)) expanded.entries.push(p);
            });
          }
        }
      }

      if (current) {
        this.enqueueOwnerAndContainerAncestors(pendingTypes, expanded, current, chain.slice(0, -1));
      }
    }

    // a component reached both top-level and nested by the selected ops must pick one form before
    // anything below reads dependencies()/isFlat() on it. #121
    this.resolveDivergentUnionForms(expanded);

    // Leaves out each field that leads back to a type still on an op's walk, before anything reads
    // which fields a type writes. #10 #89 #242
    this.leaveOutLoopFields(expanded);

    // first pass is to consolidate all Composed & Union nodes
    const composed: Array<Composed> = Array.from(pendingTypes.values())
      .filter((t) => t instanceof Composed)
      .map((t) => t as Composed);

    for (const comp of composed) {
      if (!comp.visited) comp.visit(this.gen.context!);
      comp.consolidate().forEach((id) => pendingTypes.delete(id));
    }

    // a field removed on some routes but kept on others is removed on every route. #89
    this.consolidateRemovedFields(pendingTypes, expanded);

    // keep exactly the types the written schema references (#26) — e.g. stripe's TaxId is reached
    // only as `[TaxId]` inside Customer.taxIds, never as any op's own top-level result, so it's
    // missing from pendingTypes until this loop adds it. A type is written from a route this pass
    // reached it on. #242
    for (let removedAny = true; removedAny; ) {
      const reachedFirst = this.collectReachable(expanded);
      let { reachable, routes } = reachedFirst;
      // Builds each mixed value again from all its routes before anything is dropped, so it reaches
      // what they select; a type is still added in the order this pass first reached it
      while (this.keepMixedValueRoutes(pendingTypes, expanded, reachable, routes)) {
        ({ reachable, routes } = this.collectReachable(expanded));
      }
      const roots = this.writtenRoots(expanded);
      for (const [id, type] of Array.from(pendingTypes.entries())) {
        // Moves a type not reached on the route it is written from to the back, as an unreached copy
        // gave its place to a reached one: the written order stays the one it always was
        if (!reachable.has(type) || !this.isReachedOnWrittenPath(expanded, type, routes, roots)) {
          pendingTypes.delete(id);
        }
      }
      // Puts a mixed value's rebuilt object type in the place of the one this pass first reached
      const rebuiltById = new Map<string, IType>();
      for (const type of reachable) {
        if (!rebuiltById.has(type.id)) rebuiltById.set(type.id, type);
      }
      for (const first of [...reachedFirst.reachable, ...reachable]) {
        const type = reachable.has(first) ? first : rebuiltById.get(first.id);
        if (type && !pendingTypes.has(type.id)) {
          pendingTypes.set(type.id, type);
        }
      }
      this.keepReachedWrittenPaths(expanded, reachable, routes, roots);
      // #125 needs that same final set, and can itself shrink it — commenting out the one field
      // that reached a type drops that type too — so re-run both until a pass changes nothing.
      removedAny = this.removeFieldsNeverSelected(pendingTypes, expanded) > 0;
    }

    // #207: on the final, settled set only, so this fires exactly once per collect() call.
    this.warnMismatchedSelections(pendingTypes, expanded);

    this.types = pendingTypes;
    this.expanded = expanded;
  }

  // Queues a selected node's owner in pendingTypes, then the owner's container ancestors up to the
  // op, so each is written; a plain value queues nothing. The first node queued per id is the one written.
  //   e.g. (same-name-fields.yaml) the leaf InnerExtension.value queues InnerExtension, then Outer,
  //   OuterExtension, Inner
  // `chain` is the route from the op to the node's parent: a shared node has no one parent chain.
  // Each node queued here keeps the route it was first reached on as its written route. #242
  private enqueueOwnerAndContainerAncestors(
    pendingTypes: Map<string, IType>,
    expanded: ExpandedSelection,
    node: IType,
    chain: IType[],
  ): void {
    if (node instanceof Scalar) {
      return;
    }
    const route = [...chain, node];
    let ownerAt = route.length - 1;
    while (ownerAt > 0 && route[ownerAt] instanceof Prop) {
      ownerAt--;
    }
    const pathTo = (at: number) => Naming.pathUnder('', ...route.slice(0, at + 1).map((step) => step.id));
    const owner = route[ownerAt];
    expanded.keepWrittenPath(owner, pathTo(ownerAt));
    if (!pendingTypes.has(owner.id)) {
      pendingTypes.set(owner.id, owner);
    }

    // add all ancestors (of the parent of the prop) that are containers so they are generated
    // accordingly; picked before any is set, so of two on the route sharing an id the later one is
    // queued, in the earlier one's place (an allOf wrapper named after the allOf it wraps)
    //   e.g. (spotify) AudiobookObject.chapters: allOf [$ref PagingSimplifiedChapterObject]
    const queued = route
      .map((dep, at) => ({ node: dep, path: pathTo(at) }))
      .slice(0, ownerAt + 1)
      .filter(({ node: dep }) => !pendingTypes.has(dep.id) && T.isContainer(dep));
    for (const { node: dep, path } of queued) {
      expanded.keepWrittenPath(dep, path);
      pendingTypes.set(dep.id, dep);
    }
  }

  // The selected operations' result and body nodes — where the read-only walks start. #26 #89
  private selectedRoots(expanded: ExpandedSelection): QueuedNode[] {
    const opIds = new Set(expanded.entries.map((p) => p.split(Naming.PATH_SEPARATOR)[0]));
    const roots: QueuedNode[] = [];
    for (const op of this.gen.paths.values()) {
      if (opIds.has(op.id)) {
        const candidates = [_.get(op, 'resultType'), _.get(op, 'body')] as Array<IType | undefined>;
        roots.push(
          ...candidates
            .filter((n): n is IType => !!n)
            .map((node) => ({ node, path: Naming.pathUnder(op.id, node.id) })),
        );
      }
    }
    return roots;
  }

  // The selected operations' written result and body — where the reachability walk starts. An op
  // configured to return a payload field reaches only that field's type, not the rest of the wrapper.
  //   e.g. (ashby) oneOf [{ success, results: Job }, { success, errors: [ErrorDetail] }] with
  //   payload "results" reaches Job, not the wrapper or ErrorDetail.
  private writtenRoots(expanded: ExpandedSelection): QueuedNode[] {
    const context = this.gen.context!;
    const opIds = new Set(expanded.entries.map((p) => p.split(Naming.PATH_SEPARATOR)[0]));
    const roots: QueuedNode[] = [];
    for (const op of this.gen.paths.values()) {
      if (opIds.has(op.id)) {
        const payload = T.isOp(op) ? findPayload(context, op) : undefined;
        const resultType = _.get(op, 'resultType') as IType | undefined;
        const body = _.get(op, 'body') as IType | undefined;
        if (payload) {
          roots.push({ node: payload, path: op.propPath(payload, op.id) });
        } else if (resultType) {
          roots.push({ node: resultType, path: Naming.pathUnder(op.id, resultType.id) });
        }
        if (body) {
          roots.push({ node: body, path: Naming.pathUnder(op.id, body.id) });
        }
      }
    }
    return roots;
  }

  // Leaves out every field that closes a loop, walking each selected op's written types once per op:
  // a field whose type is still on the walk's stack is left out on the type that writes it, for every
  // route, as #89 writes its removals; a real union's member on the stack is left out of that union.
  // What one op leaves out adds to what the others do. see docs/FIXED.md #10 #89 #242
  //   e.g. (cycle-on-some-routes.yaml) get:/graph: Space.homepage leads back to Content -> homepage
  private leaveOutLoopFields(expanded: ExpandedSelection): void {
    const context = this.gen.context!;
    const rootsByOp = new Map<string, QueuedNode[]>();
    for (const root of this.writtenRoots(expanded)) {
      const opId = root.path.split(Naming.PATH_SEPARATOR)[0];
      (rootsByOp.get(opId) ?? rootsByOp.set(opId, []).get(opId)!).push(root);
    }
    const loopEdges: LoopEdge[] = [];
    for (const [opId, roots] of rootsByOp) {
      const walked = new Set<IType | string>();
      const stack: LoopWalkStep[] = [];
      for (const root of roots) {
        this.walkWrittenTypes(expanded, root.node, root.path, { opId }, walked, stack, loopEdges);
      }
    }
    for (const { writer, field, member, opId } of loopEdges) {
      if (field) {
        context.commentOutField(writer!, field, field.name);
      } else if (writer instanceof Union && member && opId) {
        writer.leaveOutMember(opId, member);
        warn(
          context,
          '[collector]',
          `${member.id} leads back to its union ${writer.id} on ${opId} — left out of it there`,
        );
      }
    }
  }

  // One step of leaveOutLoopFields' walk: `edge` is how the walk got to `node`. A container is a
  // written type: it goes on the stack and is walked once; anything else passes the edge on.
  //   e.g. (cycle-on-some-routes.yaml) Space's homepage field, then its PropObj, then Content
  private walkWrittenTypes(
    expanded: ExpandedSelection,
    node: IType,
    path: string,
    edge: LoopEdge,
    walked: Set<IType | string>,
    stack: LoopWalkStep[],
    loopEdges: LoopEdge[],
  ): void {
    const context = this.gen.context!;
    const container = T.isContainer(node);
    const identity = container ? this.findLoopIdentity(node) : node;
    if (container && stack.some((step) => step.identity === identity)) {
      loopEdges.push(this.findLoopEdge(edge, stack, node));
      return;
    }
    if (container && walked.has(identity)) {
      return;
    }
    if (container) {
      walked.add(identity);
      stack.push({ node, identity, edge });
    }
    // Walks a merged union's member fields as selected, not merged: merging names the fields and
    // enums it makes, which the writer does later, in its own order. A member still on the stack is
    // left out of the union, as a real union's is, its fields not walked.
    //   e.g. (TMF632) PartyOrPartyRole under Individual.relatedParty leaves out its member Individual
    const dependencies =
      node instanceof Union && node.isFlat()
        ? node.children.flatMap((member) => {
            const target = T.findLastArrayItemIn(member);
            if (
              target &&
              T.isContainer(target) &&
              stack.some((step) => step.identity === this.findLoopIdentity(target))
            ) {
              loopEdges.push({ opId: edge.opId, writer: node, member });
              return [];
            }
            return node
              .findMemberFields(member, expanded, path)
              .map((field) => ({ node: field.prop, path: field.path }));
          })
        : node.findDependencies(context, expanded, path);
    for (const dependency of dependencies) {
      const next: LoopEdge = container
        ? { opId: edge.opId, writer: node, field: dependency.node instanceof Prop ? dependency.node : undefined }
        : { opId: edge.opId, writer: edge.writer, field: edge.field ?? (node instanceof Prop ? node : undefined) };
      this.walkWrittenTypes(expanded, dependency.node, dependency.path, next, walked, stack, loopEdges);
    }
    if (container) {
      stack.pop();
    }
  }

  // Returns what a written type counts as on the loop walk: an allOf of only a $ref is the type it
  // wraps (#238); a union whose members are all $refs is its set of members (#118); else itself.
  //   e.g. (jira-platform) NotificationEvent.templateEvent's allOf wraps NotificationEvent -> NotificationEvent
  private findLoopIdentity(node: IType): IType | string {
    if (node instanceof Composed) {
      return node.findWrappedType() ?? node;
    }
    if (node instanceof Union) {
      return node.findMemberRefs() ?? node;
    }
    return node;
  }

  // Finds what to leave out for the edge that leads back to `target`: the field it goes through, on
  // the type that writes it; for a map's value, the field that leads into the map; for a real
  // union, the member.
  //   e.g. (map-recursive-value.yaml) Amount > alternatives > AlternativesEntry > Amount -> alternatives
  private findLoopEdge(edge: LoopEdge, stack: LoopWalkStep[], target: IType): LoopEdge {
    if (edge.writer instanceof Union && !edge.field) {
      return { opId: edge.opId, writer: edge.writer, member: target };
    }
    for (let at = stack.length - 1; at >= 0 && !edge.field; at--) {
      edge = stack[at].edge;
    }
    return edge;
  }

  // A union is one node on every route that reaches it: it takes the real form only when every
  // route reaches it as the op's response, else the merged form everywhere, so the SDL agrees with
  // every op's own selection; the mixed-value form only when every route reaches it as a field, list
  // item or map value. Every route under the selected ops counts. see docs/FIXED.md #121 #242
  //   e.g. (per-op-green-whole-red.yaml) /media returns Media, /shelf has featured: Media -> merged
  private resolveDivergentUnionForms(expanded: ExpandedSelection): void {
    const routesByUnion = new Map<Union, UnionRoutes>();
    const recordRoute = (node: IType, ancestors: IType[]) => {
      if (!(node instanceof Union)) {
        return;
      }
      const parent = ancestors[ancestors.length - 1];
      let nearestAt = ancestors.length - 1;
      while (nearestAt > 0 && ancestors[nearestAt] instanceof Arr) {
        nearestAt--;
      }
      const nearest = ancestors[nearestAt];
      const known = routesByUnion.get(node) ?? { topLevel: true, valueOrItem: true };
      routesByUnion.set(node, {
        topLevel: known.topLevel && nearest instanceof Res,
        valueOrItem: known.valueOrItem && Union.isValueOrItemParent(parent),
      });
    };
    for (const { node: root } of this.selectedRoots(expanded)) {
      // a root is a Res or Body, so each union below has the root in its ancestors
      T.traverse(root, recordRoute, undefined, (child, ancestors) => recordRoute(child, ancestors));
    }
    for (const [union, routes] of routesByUnion) {
      union.everyRouteTopLevel = routes.topLevel;
      union.everyRouteValueOrItem = routes.valueOrItem;
    }
  }

  // Every type the written schema will point at, walked over each node's own dependencies()
  // from the selected operations' result/body, and the routes each node was reached on, in visit
  // order. A node is walked once per route, since its fields depend on the route: once per op under
  // a `>**` root, once per path under an explicit entry. see #26 #242
  //   e.g. `getUser: User` + `User.address: Address` reaches { User, Address }
  private collectReachable(expanded: ExpandedSelection): ReachedTypes {
    const context = this.gen.context!;
    const queue = this.writtenRoots(expanded);
    const walked = new Map<IType, Set<string>>();
    const routes = new Map<IType, string[]>();
    while (queue.length > 0) {
      const { node, path } = queue.pop()!;
      const routeKey = this.findRouteKey(expanded, path);
      const keys = walked.get(node) ?? walked.set(node, new Set()).get(node)!;
      if (keys.has(routeKey)) {
        continue;
      }
      // every container was expanded by the collect loop before this walk — an unvisited one means
      // a missed reference that would silently truncate the schema. Enums are exempt: visited via
      // their own field (#57). dependencies() stays read-only: no visit(), no context stack. #26
      if (!node.visited && T.isContainer(node)) {
        throw new Error(`collectReachable: unvisited type ${node.id} — the collect walk missed a reference`);
      }
      keys.add(routeKey);
      (routes.get(node) ?? routes.set(node, []).get(node)!).push(path);
      queue.push(...node.findDependencies(context, expanded, path));
    }

    return { reachable: new Set(Array.from(walked.keys()).filter(T.isEmittable)), routes };
  }

  // True when `type` can be reached along the path it is written from, or no path is recorded yet:
  // the pass reached it there, or each step of the path is a dependency of the step before, from the
  // op's written root. A type not reached there moves to the back, as an unreached copy did.
  //   e.g. (cycle-on-some-routes.yaml) Doc, queued under Member.home but reached under Link.subject
  private isReachedOnWrittenPath(
    expanded: ExpandedSelection,
    type: IType,
    routes: Map<IType, string[]>,
    roots: QueuedNode[],
  ): boolean {
    if (!expanded.hasWrittenPath(type)) {
      return true;
    }
    const writtenPath = expanded.writtenPath(type);
    if ((routes.get(type) ?? []).includes(writtenPath)) {
      return true;
    }
    const context = this.gen.context!;
    const isOnPath = (path: string) => writtenPath === path || writtenPath.startsWith(path + Naming.PATH_SEPARATOR);
    let step = roots.find((root) => isOnPath(root.path));
    while (step && step.path !== writtenPath) {
      step = step.node.findDependencies(context, expanded, step.path).find((dependency) => isOnPath(dependency.path));
    }
    return step?.node === type;
  }

  // Returns the route a walk keys a node's visit on: its op under a `>**` root, else the path itself.
  //   e.g. get:/nodes>res:r>obj:type:#/c/s/Node under get:/nodes>** -> get:/nodes
  private findRouteKey(expanded: ExpandedSelection, path: string): string {
    return expanded.findWildcardOp(path) ?? path;
  }

  // Keeps each reached type's written route when this pass reached it on that route, else gives it
  // the first route the pass reached it on. A mixed value keeps its own rule (keepMixedValueRoutes). #242
  //   e.g. (shared-component-two-ops.yaml) Envelope is written from /g once /e's route never reaches it
  private keepReachedWrittenPaths(
    expanded: ExpandedSelection,
    reachable: Set<IType>,
    routes: Map<IType, string[]>,
    roots: QueuedNode[],
  ): void {
    for (const node of reachable) {
      if (this.isMixedValuePart(node)) {
        continue;
      }
      if (expanded.hasWrittenPath(node) && this.isReachedOnWrittenPath(expanded, node, routes, roots)) {
        continue;
      }
      expanded.replaceWrittenPath(node, routes.get(node)![0]);
    }
  }

  // Writes each mixed value and its object type from the last route reaching them, and builds a
  // mixed value again when its routes change, finding its removed fields again. This keeps today's
  // output, where each op built its own copy and the one built last was written. Returns whether a
  // mixed value was built again. see docs/FIXED.md #242
  //   e.g. (shared-union-fields.yaml) /m selects amount, /o rate.value -> RObject { rate }, in either order
  private keepMixedValueRoutes(
    pendingTypes: Map<string, IType>,
    expanded: ExpandedSelection,
    reachable: Set<IType>,
    routes: Map<IType, string[]>,
  ): boolean {
    let rebuilt = false;
    for (const node of reachable) {
      if (!this.isMixedValuePart(node)) {
        continue;
      }
      const reachedOn = routes.get(node)!;
      expanded.replaceWrittenPath(node, reachedOn[reachedOn.length - 1]);
      if (node instanceof Union && !_.isEqual(node.mixedValue!.routes, reachedOn)) {
        node.rebuildMixedValue(this.gen.context!, expanded, reachedOn);
        rebuilt = true;
      }
    }
    if (rebuilt) {
      this.consolidateRemovedFields(pendingTypes, expanded);
    }
    return rebuilt;
  }

  // True for a mixed-value union and for the object type that holds its object members' fields.
  //   e.g. (shared-union-fields.yaml) R and RObject
  private isMixedValuePart(node: IType): boolean {
    return (
      (node instanceof Union && node.mixedValue !== undefined) ||
      (node.parent instanceof Union && node.parent.mixedValue?.objectType === node)
    );
  }

  // A field cycle detection (#10) removed on some routes but kept on others is removed on every
  // route, a comment in its place: the composer wants a declared field provided everywhere the
  // type appears. see docs/FIXED.md #89 (and #13 for the donation this replaces)
  //   e.g. (confluence) results.source: Content { space: Space }
  //                     results.source.homepage: Content { # space — removed }  -> removed on both
  private consolidateRemovedFields(pendingTypes: Map<string, IType>, expanded: ExpandedSelection): void {
    const context = this.gen.context!;

    // a field removed on one route AND kept on another needs an override — removed everywhere
    // already prints as a comment, kept everywhere needs nothing
    const { kept, removed } = this.walkKeptAndRemoved(expanded);
    for (const type of pendingTypes.values()) {
      type.props.forEach((prop, name) => {
        if (!removed.get(type.id)?.has(name) || !kept.get(type.id)?.has(name)) {
          return;
        }
        context.commentOutField(type, prop, name);
      });
    }
  }

  // #125: extends #89 to a field that no route ever lost to a cycle — it just never appears in
  // any route's own selection, e.g. `Customer.sources` declared but no connector selects it.
  // Same fix as #89: comment it out everywhere. Returns how many fields this pass commented out.
  private removeFieldsNeverSelected(pendingTypes: Map<string, IType>, expanded: ExpandedSelection): number {
    const context = this.gen.context!;
    const { kept } = this.walkKeptAndRemoved(expanded);
    let removedCount = 0;
    for (const type of pendingTypes.values()) {
      if (!T.isFieldOwner(type)) {
        continue;
      }
      // Lists the type's own declared fields on the route it is written from, skipping ones already commented out
      const declared = type
        .dependencies(context, expanded, expanded.writtenPath(type))
        .filter((dep): dep is Prop => dep instanceof Prop && !(dep instanceof PropCircRef));
      for (const prop of declared) {
        if (kept.get(type.id)?.has(prop.name)) {
          continue;
        }
        context.commentOutField(type, prop, prop.name);
        removedCount++;
      }
    }
    if (removedCount > 0) {
      trace(context, '[collector::removeFieldsNeverSelected]', `commented out ${removedCount} field(s)`);
    }
    return removedCount;
  }

  // same walk as collectReachable, but records what each visited type's own fields are: e.g.
  // (confluence) Content is reached at 6 positions, kept "space" at 2 (naming those two ops) and
  // lost it to a cycle at the other 4 -> removed.get('Content') has "space" too. see #207
  private walkKeptAndRemoved(expanded: ExpandedSelection): {
    kept: Map<string, Map<string, Set<string>>>;
    removed: Map<string, Set<string>>;
  } {
    const context = this.gen.context!;
    const removed = new Map<string, Set<string>>();
    // type id -> field name -> the set of op ids whose own selection kept that field.
    //   e.g. (ashby, #207) application.create selects results { id }, referral.create selects
    //   results { id createdAt }, both on Application -> kept.get('obj:type:#/c/s/Application') is
    //   Map { "id" -> Set { both ops }, "createdAt" -> Set { "post:/referral.create" } }
    const kept = new Map<string, Map<string, Set<string>>>();
    const queue = this.selectedRoots(expanded);
    const walked = new Map<IType, Set<string>>();
    while (queue.length > 0) {
      const { node, path } = queue.pop()!;
      const routeKey = this.findRouteKey(expanded, path);
      const keys = walked.get(node) ?? walked.set(node, new Set()).get(node)!;
      if (keys.has(routeKey)) {
        continue;
      }
      keys.add(routeKey);
      const dependencies = node.findDependencies(context, expanded, path);
      const children = dependencies.map((dependency) => dependency.node);
      // #207 for a mixed value: the object-member fields this route selects count as kept on the
      // object type, which is written from one route only.
      //   e.g. (ashby) CustomField.value: city on one route, currencyCode on the written one
      if (node instanceof Union && node.mixedValue?.objectType) {
        const objectType = node.mixedValue.objectType;
        const opId = path.split(Naming.PATH_SEPARATOR)[0];
        for (const index of node.analyzeMixedValue(context, true)?.objectMemberIndexes ?? []) {
          for (const field of node.findMemberFields(node.children[index], expanded, path)) {
            this.keepField(kept, objectType.id, field.prop.name, opId);
          }
        }
      }
      if (T.isFieldOwner(node)) {
        for (const child of children) {
          if (child instanceof Prop) {
            if (child instanceof PropCircRef) {
              // a PropCircRef is a route that lost the field to a cycle
              let names = removed.get(node.id);
              if (!names) {
                names = new Set();
                removed.set(node.id, names);
              }
              names.add(child.name);
              continue;
            }

            // i.e.: "createdAt" -> Set { "post:/referral.create" } }.
            this.keepField(kept, node.id, child.name, path.split(Naming.PATH_SEPARATOR)[0]);
          }
        }
      }
      queue.push(...dependencies);
    }
    return { kept, removed };
  }

  // Records that `opId`'s selection kept `field` on the type `typeId`.
  //   e.g. (ashby) kept 'obj:type:#/c/s/Application' -> "createdAt" -> { "post:/referral.create" }
  private keepField(kept: Map<string, Map<string, Set<string>>>, typeId: string, field: string, opId: string): void {
    const byField = kept.get(typeId) ?? kept.set(typeId, new Map()).get(typeId)!;
    const ops = byField.get(field) ?? byField.set(field, new Set()).get(field)!;
    ops.add(opId);
  }

  // two ops sharing one component can select different fields of it — the type is written from
  // the first op's selection only. e.g. (ashby) application.create selects results { id },
  // referral.create also selects createdAt on the same #/c/s/Application. see docs/FIXED.md #207
  private warnMismatchedSelections(pendingTypes: Map<string, IType>, expanded: ExpandedSelection): void {
    const context = this.gen.context!;
    const keep = context.generateOptions?.keepFieldNames === true;
    const { kept } = this.walkKeptAndRemoved(expanded);
    for (const type of pendingTypes.values()) {
      if (!T.isFieldOwner(type)) {
        continue;
      }
      const byField = kept.get(type.id);
      if (!byField) {
        continue;
      }
      const writtenPath = expanded.writtenPath(type);
      const declared = new Set(type.selectedProps(expanded, keep, writtenPath).map((prop) => prop.name));
      // Takes the op from the route the type is written from: its selection is the one written. #207 #242
      const declaredOp = writtenPath.split(Naming.PATH_SEPARATOR)[0];

      const extraByOp = new Map<string, Set<string>>();
      for (const [field, ops] of byField) {
        if (declared.has(field)) {
          continue;
        }
        for (const op of ops) {
          if (op === declaredOp) {
            continue;
          }
          let extra = extraByOp.get(op);
          if (!extra) {
            extra = new Set();
            extraByOp.set(op, extra);
          }
          extra.add(field);
        }
      }
      if (extraByOp.size === 0) {
        continue;
      }
      const others = Array.from(extraByOp.entries())
        .map(([op, fields]) => `${op} also selects ${Array.from(fields).join(', ')}`)
        .join('; ');
      const extraFields = Array.from(new Set(Array.from(extraByOp.values()).flatMap((fields) => Array.from(fields))));
      warn(
        context,
        '[collector]',
        `\`${Naming.getRefName(type.name)}\` is written from ${declaredOp}'s selection; ${others} on it, which the type won't declare. Select the same ${Naming.getRefName(type.name)} fields on both, or drop ${extraFields.join(', ')}.`,
      );
    }
  }
}

class PathsCollector {
  constructor(private gen: OasGen) {}

  public static findNonPropParent(type: IType) {
    let parent = type;
    while (parent instanceof Prop) {
      parent = parent.parent!;
    }
    return parent;
  }

  public static progressiveSplits(input: string): string[] {
    const parts = input.split(Naming.PATH_SEPARATOR);
    const results: string[] = [];
    for (let i = 1; i <= parts.length; i++) {
      results.push(parts.slice(0, i).join(Naming.PATH_SEPARATOR));
    }
    return results;
  }

  public collectPaths(path: string, collection: IType[]): IType[] {
    const context = this.gen.getContext();
    const stack: IType[] = [];
    let current: IType | undefined;
    let last: IType | undefined;

    let i = 0;
    const parts = path.split(Naming.PATH_SEPARATOR);
    do {
      const part = Naming.expandRef(parts[i]);

      current = SelectionPath.resolveSegment(context, last, collection, part);
      if (!current) {
        throw new Error('Could not find type: ' + part + ' from ' + path + ', last: ' + last?.pathToRoot());
      }

      // make sure we expand it before we move on to the next part
      this.gen.expand(current);
      last = current;

      collection = Array.from(current!.children.values()) || Array.from(current!.props.values()) || [];

      stack.push(current);
      i++;
    } while (i < parts.length);

    return stack;
  }

  // Reports every leaf under `root` to `target` with the chain the walk went through, expanding
  // along the way, and returns how many; nothing below a leaf is expanded. `prefix` is the chain
  // from the op to the root's parent. A field leading back to a node on the walk is a leaf, written
  // as a field or as the comment leaveOutLoopFields puts in its place. #242
  //   e.g. (cycles-by-route.yaml) root get:/nodes reports Node.id with get:/nodes, res:r and Node
  public collectLeafPaths(root: IType, op: IType & Op, target: LeafTarget, prefix: IType[] = []): number {
    const context = this.gen.getContext();
    let reported = 0;
    const chainOf = (ancestors: IType[]): IType[] => (prefix.length > 0 ? [...prefix, ...ancestors] : ancestors);
    const report = (leaf: IType, ancestors: IType[]): void => {
      target.add(leaf, chainOf(ancestors));
      reported++;
    };
    const envelope = envelopeContext(context, op);
    // True for a union with no object member that still types as { text, list, raw } -- the
    // property/list-item/map-value leaf checks below all call this, with the node it sits under here. #221
    //   e.g. (ashby) valueLabel: anyOf [string, array] -> ValueLabelUnion { text list raw }
    const isPlainOrListUnion = (union: Union, parentOnRoute: IType): boolean => {
      const shape = union.analyzeMixedValue(context, true, parentOnRoute);
      return shape != null && shape.objectMemberIndexes.length === 0;
    };
    target.beginWalk();
    T.traverse(
      root,
      (child, ancestors) => {
        const parentOnRoute = ancestors.length > 0 ? ancestors[ancestors.length - 1] : prefix[prefix.length - 1];
        // Reports the field back to a type on the route above the root as a leaf, as one on the walk
        // is, and walks no further: the rest of that type is not what the root selects. A union with
        // the same members as one open on the route is that same choice again. #118 #242
        //   e.g. (stripe) payment_intent>last_payment_error>** reaches api_errors.payment_intent
        //   e.g. (hubspot lists) OrFilterBranch.filterBranches reopens the branch choice
        if (
          (T.isContainer(child) && prefix.includes(child)) ||
          this.isChoiceOnRoute(child, [...prefix, ...ancestors])
        ) {
          this.reportLoopField(child, ancestors, report);
          return false;
        }
        // A field the overrides file reads through isSuccess or errors, or anything inside it, is not selected;
        // the @connect already handles it. Nothing below it is walked for this op. see docs/FIXED.md #232
        //   e.g. (ashby) application.list: errors and ErrorDetail.message are skipped, nextCursor is selected.
        if (isEnvelopeNode(child, chainOf(ancestors), envelope)) {
          target.exclude(op.id, child);
          return false;
        }
        // a list of lists of plain values is a leaf too — there is nothing below it to select, and
        // the field vanished with the op when it was the only property. see docs/FIXED.md #96
        //   e.g. (digitalocean) neighbor_ids: { type: array, items: { type: array, items: integer } }
        const listOfValues = child instanceof PropArray && child.items instanceof Scalar;
        const nestedListOfValues =
          child instanceof PropArray && child.items instanceof Arr && child.items.itemsType instanceof Scalar;
        // a list of enum values is a leaf too, or the field vanishes and an only-property body
        // goes empty; illegal values are degraded to plain strings long before reaching here.
        //   e.g. (motion) include: { type: array, items: { type: string, enum: [workHours] } }
        // see docs/FIXED.md #170 #172
        const listOfEnumValues = child instanceof PropArray && child.items instanceof En;
        // a list of `string | [string]` values is the same leaf, at the list-item position. #221
        const listOfPlainOrList =
          child instanceof PropArray && child.items instanceof Union && isPlainOrListUnion(child.items, child);
        if (T.isPropScalar(child) || listOfValues || nestedListOfValues || listOfEnumValues || listOfPlainOrList) {
          report(child, ancestors);
        } else if (child instanceof PropEn) {
          // enum props are leaves too — without this, `>**` silently drops every enum field
          // (slack's `ok`-only stubs collapsed to zero types). see docs/FIXED.md #24
          report(child, ancestors);
        } else if (child instanceof PropComp && child.comp instanceof Union && isPlainOrListUnion(child.comp, child)) {
          // a no-object-member mixed-value property, e.g. (ashby) valueLabel: anyOf [string, array]. #221
          report(child, ancestors);
        } else if (child instanceof PropCircRef) {
          // Includes a left-out cycle's path as a leaf, so the commented field is emitted (in both
          // the SDL and the selection) instead of silently dropped. see docs/FIXED.md #10
          report(child, ancestors);
        } else if (child instanceof Scalar && parentOnRoute instanceof Res) {
          // a response that is just a value, no object around it — a write answering `true` (adobe
          // commerce), or a token string (petstore `/user/login`):
          //   responses: { '200': { schema: { type: boolean } } }
          // Nothing to pick apart, so the value itself is the leaf. see docs/FIXED.md #32
          report(child, ancestors);
        } else if (child instanceof En && parentOnRoute instanceof Res) {
          // a response that is just an enum value, no object around it — same shape as #32's bare
          // scalar, just enum-typed. see docs/FIXED.md #120
          report(child, ancestors);
        } else if (child instanceof Arr && parentOnRoute instanceof Res && child.itemsType instanceof Scalar) {
          // the case above with a list around it — a response that is just an array of values,
          // no object around it (spotify's "check saved" endpoints answer `[true, false]`):
          //   responses: { '200': { schema: { type: array, items: { type: boolean } } } }
          // Nothing to pick apart, so the array itself is the leaf. see docs/FIXED.md #47
          report(child, ancestors);
        } else {
          // the value type is only known once the node is expanded, so the map check comes after
          this.gen.expand(child);
          // An object that declares no properties is selected whole; its field is written as JSON.
          // e.g. (stripe) payment_method_amazon_pay: { type: object } -> amazonPay: JSON
          // Response side only, the check below still owns the body side. see docs/FIXED.md #182
          if (child instanceof PropObj && _.isEmpty(child.obj.props) && child.kind !== 'input') {
            report(child, ancestors);
          }
          // A map of plain values has nothing below it to select — the map itself is the leaf,
          // whether it hangs off a property (#70) or is the whole response (#92).
          //   e.g. (map-input-suffix.yaml) labels: { additionalProperties: { type: string } }  #70
          //   e.g. (github) get:/emojis: { additionalProperties: string }  #92
          // (whole values only: a value left out to break a cycle would select with no fields against a composite SDL type  #76, #182)
          const mapUnderProp = child instanceof PropMap ? child.map : undefined;
          const mapAsResponse = child instanceof MapNode && parentOnRoute instanceof Res ? child : undefined;
          // a map nested inside another map's value fits neither case above, so a map of maps of
          // plain values silently lost its whole field. see docs/FIXED.md #171
          //   e.g. additionalProperties: { additionalProperties: { type: integer } }
          const mapNested = child instanceof MapNode && parentOnRoute instanceof MapNode ? child : undefined;
          const map = mapUnderProp ?? mapAsResponse ?? mapNested;
          // a map value that is a no-object-member mixed-value union is whole too. #221
          if (
            map?.valueType &&
            (T.isWholeMapValue(map.valueType) ||
              (map.valueType instanceof Union && isPlainOrListUnion(map.valueType, map)))
          ) {
            report(child, ancestors);
          }
        }
      },
      undefined,
      (child, ancestors, onStack) => {
        if (onStack) {
          this.reportLoopField(child, ancestors, report);
        } else {
          target.markIfWalked(op.id, child, chainOf(ancestors));
        }
      },
    );

    // a side of the op whose expansion found nothing selectable still has fields to write when
    // its only content is a free-form JSON object (asana: `data: $ref EmptyResponse` ->
    // `data: JSON`, emitted as an EMPTY invalid type before) — take those fields as the leaves, for
    // this op only. Per side, not per op: a write whose body is selectable can still answer with an
    // empty object, and checking the op as a whole never fires for it. see docs/FIXED.md #32, #51
    const sides = T.isOp(root) ? root.children : [root];
    const sidePrefix = T.isOp(root) ? [...prefix, root] : prefix;
    for (const side of sides) {
      if (target.hasLeafUnder(side)) {
        continue;
      }
      // scoped to an otherwise-empty side on purpose: doing it everywhere diverged the
      // selections of types shared across connectors. see docs/FIXED.md #32
      T.traverse(side, (child, ancestors) => {
        if (child instanceof PropObj && _.isEmpty(child.obj?.props)) {
          target.addForOp(op.id, child, [...sidePrefix, ...ancestors]);
          reported++;
        }
      });
    }
    return reported;
  }

  // True when `node` is a union whose members, all $refs, are those of a union already on `route`.
  //   e.g. (hubspot lists) filterBranches: oneOf [$ref OrBranch, …] under OrBranch, below the same oneOf
  private isChoiceOnRoute(node: IType, route: IType[]): boolean {
    const memberRefs = node instanceof Union ? node.findMemberRefs() : undefined;
    return (
      memberRefs !== undefined && route.some((step) => step instanceof Union && step.findMemberRefs() === memberRefs)
    );
  }

  // Reports the field that leads back to `child`, still on the walk's stack: the nearest field
  // between them. Its target's leaves may lie further on in this walk, so it is kept selected here.
  //   e.g. (map-recursive-value.yaml) Amount > alternatives > AlternativesEntry > Amount -> alternatives
  private reportLoopField(child: IType, ancestors: IType[], report: (leaf: IType, ancestors: IType[]) => void): void {
    const loopAt = ancestors.lastIndexOf(child);
    for (let at = ancestors.length - 1; at > loopAt; at--) {
      if (ancestors[at] instanceof Prop) {
        report(ancestors[at], ancestors.slice(0, at));
        return;
      }
    }
  }

  // Returns the selection path of `node`: the path above the walk root, then the ids of the
  // ancestors the walk went through, then the node's own id, joined the way Type.path() joins them.
  //   e.g. (cycles-by-route.yaml) prefix "", ancestors get:/nodes, res:r and Node, node prop:scalar:id
  //   -> get:/nodes>res:r>obj:type:#/c/s/Node>prop:scalar:id
  public pathFromWalk(prefix: string, ancestors: IType[], node: IType): string {
    return Naming.pathUnder(prefix, ...ancestors.map((ancestor) => ancestor.id), node.id);
  }

  public collectExpandedPaths(selection: string[]): ExpandedSelection {
    const context = this.gen.getContext();
    const newSelection = new ExpandedSelection([]);
    // A bare op (no path segments) never gets walked past the op node itself, so its response/body
    // silently never visits. Treat it as `<op>>**`, the same full-subtree walk every other op gets.
    //   e.g. ['get:/widgets/{id}'] -> walked as 'get:/widgets/{id}>**'. see docs/FIXED.md #136
    const isBareOp = (p: string) => !p.includes(Naming.PATH_SEPARATOR);
    const expands = selection.filter((p) => p.endsWith('>**') || isBareOp(p));
    const filtered = expands.map((p) => (p.endsWith('>**') ? p.replace('>**', '') : p));

    const paths = Array.from(this.gen.paths.values());
    const nodes = filtered.map((p) => this.collectPaths(p, paths));

    // Leaves out a root that found no leaf, so it selects nothing and its op is not written.
    //   e.g. (allof-two-plain-members.yaml) get:/actions>…>prop:comp:region_slug>** has no leaf
    nodes.forEach((stack) => {
      const root = _.last(stack)!;
      if (this.collectLeafPaths(root, stack[0] as IType & Op, newSelection, stack.slice(0, -1)) > 0) {
        stack.forEach((node) => newSelection.nodesWithLeaves.add(node));
        newSelection.entries.push(SelectionPath.everythingUnder(Naming.pathUnder('', ...stack.map((node) => node.id))));
      }
    });

    // a saved selection or an explicit CLI path can still name an envelope field directly; drop it
    // here, unless it reaches its target through a literal `*` (resolveSegment can't resolve that).
    //   e.g. (ashby) a saved `post:/widget.list>success` path is dropped, `post:/widget.list>*` is not.
    const envelopeByOp = new Map<string, EnvelopeContext>();
    const passThrough = selection
      .filter((p) => !expands.includes(p))
      .filter((p) => {
        if (p.split(Naming.PATH_SEPARATOR).includes('*')) {
          return true;
        }
        const stack = this.collectPaths(p, paths);
        const op = stack[0] as IType & Op;
        let envelope = envelopeByOp.get(op.id);
        if (!envelope) {
          envelope = envelopeContext(context, op);
          envelopeByOp.set(op.id, envelope);
        }
        return !isEnvelopeNode(_.last(stack)!, stack.slice(0, -1), envelope);
      });

    newSelection.entries.push(...passThrough);
    return newSelection;
  }
}
