import _ from 'lodash';
import { Composed } from '../nodes/comp.js';
import {
  Arr,
  En,
  IType,
  // aliased: this file builds plenty of real `Map`s, and the node class would shadow the built-in
  Map as MapNode,
  Obj,
  Prop,
  PropArray,
  PropCircRef,
  PropEn,
  PropMap,
  PropObj,
  Res,
  Scalar,
  T,
  Union,
} from '../nodes/internal.js';
import { OasGen } from '../oasGen.js';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Naming } from '../utils/naming.js';
import { SelectionPath } from '../utils/selectionPath.js';
import { GqlUtils } from '../utils/gql.js';

export class TypesCollector {
  types: Map<string, IType> = new Map();
  expanded: string[] = [];

  constructor(private gen: OasGen) {}

  public collect(selection: string[]): void {
    const pendingTypes: Map<string, IType> = new Map();
    let expanded: string[] = new PathsCollector(this.gen).collectExpandedPaths(selection);

    for (const path of expanded) {
      let collection = Array.from(this.gen.paths.values());
      let current: IType | undefined;
      let last: IType | undefined;
      let hitWildcard = false;

      let i = 0;
      const parts = path.split(Naming.PATH_SEPARATOR);
      do {
        const part = Naming.expandRef(parts[i]);
        if (part === '*') {
          hitWildcard = true;
          // remove the current path from the expanded array
          expanded = expanded.filter((s) => s !== path);

          if (current && current instanceof Composed) {
            current!.consolidate(expanded);
          }

          // add all the props from the current node and exit loop
          current?.props.forEach((child) => {
            if (T.isLeaf(child)) {
              expanded.push(child.path());
            }
          });
          break;
        }

        current = SelectionPath.resolveSegment(last, collection, part);
        if (!current) {
          const tree = T.print(last!.ancestors()[0]);

          // let's collect the possible paths so we don't have to debug
          throw new Error(
            'Could not find type: ' + part + ' from ' + path + '\nlast:\n' + last?.pathToRoot() + '\ntree: ' + tree,
          );
        }

        // make sure we expand it before we move on to the next part
        this.gen.expand(current);
        last = current;

        collection = Array.from(current!.children.values()) || Array.from(current!.props.values()) || [];
        i++;
      } while (i < parts.length);

      // #135: a saved selection can still name a field by an old, renamed name — e.g. digitalocean.yaml's
      // ActiveDeployment.cause, renamed to inlinev2AppsByAppIdDeploymentsResponseActiveDeployment after
      // browsing /v2/apps first (test_72). The walk above finds the field anyway; keep `expanded` in sync.
      if (!hitWildcard && current && current.path() !== path) {
        const idx = expanded.indexOf(path);
        if (idx !== -1) expanded[idx] = current.path();
      }

      if (current && !(current instanceof Scalar)) {
        const parentType = T.findNonPropParent(current as IType);
        if (!pendingTypes.has(parentType.id)) {
          pendingTypes.set(parentType.id, parentType);
        }

        // add all ancestors (of the parent of the prop) that are containers so they are generated accordingly
        parentType
          .ancestors()
          .filter((t) => !pendingTypes.has(t.id) && T.isContainer(t))
          .forEach((dep) => {
            pendingTypes.set(dep.id, dep);
          });
      }
    }

    // a component reached both top-level and nested by the selected ops must pick one form before
    // anything below reads dependencies()/isFlat() on it. #121
    this.resolveDivergentUnionForms(expanded);

    // first pass is to consolidate all Composed & Union nodes
    const composed: Array<Composed> = Array.from(pendingTypes.values())
      .filter((t) => t instanceof Composed)
      .map((t) => t as Composed);

    for (const comp of composed) {
      if (!comp.visited) comp.visit(this.gen.context!);
      comp.consolidate(expanded).forEach((id) => pendingTypes.delete(id));
    }

    // a field removed on some routes but kept on others is removed on every route. #89
    this.consolidateRemovedFields(pendingTypes, expanded);

    // keep exactly the types the written schema references (#26) — e.g. stripe's TaxId is reached
    // only as `[TaxId]` inside Customer.taxIds, never as any op's own top-level result, so it's
    // missing from pendingTypes until this loop adds it.
    for (let removedAny = true; removedAny; ) {
      const reachable = this.collectReachable(expanded);
      for (const [id, type] of Array.from(pendingTypes.entries())) {
        if (!reachable.has(type)) {
          pendingTypes.delete(id);
        }
      }
      for (const type of reachable) {
        if (!pendingTypes.has(type.id)) {
          pendingTypes.set(type.id, type);
        }
      }
      // #125 needs that same final set, and can itself shrink it — commenting out the one field
      // that reached a type drops that type too — so re-run both until a pass changes nothing.
      removedAny = this.removeFieldsNeverSelected(pendingTypes, expanded) > 0;
    }

    this.types = pendingTypes;
    this.expanded = expanded;
  }

  // The selected operations' result and body nodes — where the read-only walks start. #26 #89
  private selectedRoots(expanded: string[]): IType[] {
    const opIds = new Set(expanded.map((p) => p.split(Naming.PATH_SEPARATOR)[0]));
    const roots: IType[] = [];
    for (const op of this.gen.paths.values()) {
      if (opIds.has(op.id)) {
        const candidates = [_.get(op, 'resultType'), _.get(op, 'body')] as Array<IType | undefined>;
        roots.push(...candidates.filter((n): n is IType => !!n));
      }
    }
    return roots;
  }

  // A union shares one id whether reached top-level or nested (union.ts's `id`) — force the shared
  // flat form on every instance so the SDL agrees with every op's own selection. see docs/FIXED.md #121
  // e.g.:
  //   /media: get -> $ref Media                    # top level: real union, ->match selection
  //   /shelf: get -> { featured: $ref Media, ... }  # nested: merged/flat object
  //   Media: oneOf [Book, Movie], discriminator kind
  private resolveDivergentUnionForms(expanded: string[]): void {
    const byId = new Map<string, Union[]>();
    for (const root of this.selectedRoots(expanded)) {
      T.traverse(root, (node) => {
        if (node instanceof Union) {
          (byId.get(node.id) ?? byId.set(node.id, []).get(node.id)!).push(node);
        }
      });
    }
    for (const group of byId.values()) {
      if (new Set(group.map((u) => u.isFlat())).size > 1) {
        group.forEach((u) => (u.forcedFlat = true));
      }
    }
  }

  // Every type the written schema will point at, walked over each node's own dependencies()
  // from the selected operations' result/body. e.g. `getUser: User` + `User.address: Address`
  // reaches { User, Address }. see #26
  private collectReachable(expanded: string[]): Set<IType> {
    const context = this.gen.context!;
    const queue = this.selectedRoots(expanded);
    const visited = new Set<IType>();
    while (queue.length > 0) {
      const node = queue.pop()!;
      if (visited.has(node)) {
        continue;
      }
      // every container was expanded by the collect loop before this walk — an unvisited one means
      // a missed reference that would silently truncate the schema. Enums are exempt: visited via
      // their own field (#57). dependencies() stays read-only: no visit(), no context stack. #26
      if (!node.visited && T.isContainer(node)) {
        throw new Error(`collectReachable: unvisited type ${node.id} — the collect walk missed a reference`);
      }
      visited.add(node);
      queue.push(...node.dependencies(context, expanded));
    }

    return new Set(Array.from(visited).filter(T.isEmittable));
  }

  // A field cycle detection (#10) removed on some routes but kept on others is removed on every
  // route, a comment in its place: the composer wants a declared field provided everywhere the
  // type appears. see docs/FIXED.md #89 (and #13 for the donation this replaces)
  //   e.g. (confluence) results.source: Content { space: Space }
  //                     results.source.homepage: Content { # space — removed }  -> removed on both
  private consolidateRemovedFields(pendingTypes: Map<string, IType>, expanded: string[]): void {
    const context = this.gen.context!;
    // this generation's selection only — no leftovers from an earlier one
    context.propOverrides.clear();

    // a field removed on one route AND kept on another needs an override — removed everywhere
    // already prints as a comment, kept everywhere needs nothing
    const { kept, removed } = this.walkKeptAndRemoved(expanded);
    for (const type of pendingTypes.values()) {
      type.props.forEach((prop, name) => {
        if (!removed.get(type.id)?.has(name) || !kept.get(type.id)?.has(name)) {
          return;
        }
        this.commentOutField(context, type, prop, name);
      });
    }
  }

  // #125: extends #89 to a field that no route ever lost to a cycle — it just never appears in
  // any route's own selection, e.g. `Customer.sources` declared but no connector selects it.
  // Same fix as #89: comment it out everywhere. Returns how many fields this pass commented out.
  private removeFieldsNeverSelected(pendingTypes: Map<string, IType>, expanded: string[]): number {
    const context = this.gen.context!;
    const { kept } = this.walkKeptAndRemoved(expanded);
    let removedCount = 0;
    for (const type of pendingTypes.values()) {
      if (!T.isFieldOwner(type)) {
        continue;
      }
      // the type's own declared field names, skipping ones already commented out
      const declared = type
        .dependencies(context, expanded)
        .filter((dep): dep is Prop => dep instanceof Prop && !(dep instanceof PropCircRef));
      for (const prop of declared) {
        if (kept.get(type.id)?.has(prop.name)) {
          continue;
        }
        this.commentOutField(context, type, prop, prop.name);
        removedCount++;
      }
    }
    if (removedCount > 0) {
      trace(context, '[collector::removeFieldsNeverSelected]', `commented out ${removedCount} field(s)`);
    }
    return removedCount;
  }

  // swap this field for a comment everywhere the type is printed — #89's own mechanism, reused here.
  private commentOutField(context: OasContext, type: IType, prop: Prop, name: string): void {
    let overrides = context.propOverrides.get(type.id);
    if (!overrides) {
      overrides = new Map();
      context.propOverrides.set(type.id, overrides);
    }
    overrides.set(name, prop instanceof PropCircRef ? prop : new PropCircRef(type, prop));
  }

  // same walk as collectReachable, but records what each visited type's own fields are: e.g.
  // (confluence) Content is reached at 6 positions, kept "space" at 2 -> kept.get('Content') has
  // "space"; lost it to a cycle at the other 4 -> removed.get('Content') has "space" too.
  private walkKeptAndRemoved(expanded: string[]): {
    kept: Map<string, Set<string>>;
    removed: Map<string, Set<string>>;
  } {
    const context = this.gen.context!;
    const removed = new Map<string, Set<string>>();
    const kept = new Map<string, Set<string>>();
    const queue = this.selectedRoots(expanded);
    const visited = new Set<IType>();
    while (queue.length > 0) {
      const node = queue.pop()!;
      if (visited.has(node)) {
        continue;
      }
      visited.add(node);
      const children = node.dependencies(context, expanded);
      if (T.isFieldOwner(node)) {
        for (const child of children) {
          if (child instanceof Prop) {
            // a PropCircRef is a route that lost the field to a cycle; any other prop kept it
            const bucket = child instanceof PropCircRef ? removed : kept;
            let names = bucket.get(node.id);
            if (!names) {
              names = new Set();
              bucket.set(node.id, names);
            }
            names.add(child.name);
          }
        }
      }
      queue.push(...children);
    }
    return { kept, removed };
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
    const stack: IType[] = [];
    let current: IType | undefined;
    let last: IType | undefined;

    let i = 0;
    const parts = path.split(Naming.PATH_SEPARATOR);
    do {
      const part = Naming.expandRef(parts[i]);

      current = SelectionPath.resolveSegment(last, collection, part);
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

  public collectExpandedPaths(selection: string[]) {
    const newSelection = new Set<string>();
    // A bare op (no path segments) never gets walked past the op node itself, so its response/body
    // silently never visits. Treat it as `<op>>**`, the same full-subtree walk every other op gets.
    //   e.g. ['get:/widgets/{id}'] -> walked as 'get:/widgets/{id}>**'. see docs/FIXED.md #136
    const isBareOp = (p: string) => !p.includes(Naming.PATH_SEPARATOR);
    const expands = selection.filter((p) => p.endsWith('>**') || isBareOp(p));
    const filtered = expands.map((p) => (p.endsWith('>**') ? p.replace('>**', '') : p));

    const paths = Array.from(this.gen.paths.values());
    const nodes = filtered.map((p) => this.collectPaths(p, paths));

    nodes.forEach((stack) => {
      const root = _.last(stack)!;
      T.traverse(root, (child) => {
        // a list of lists of plain values is a leaf too — there is nothing below it to select, and
        // the field vanished with the op when it was the only property. see docs/FIXED.md #96
        //   e.g. (digitalocean) neighbor_ids: { type: array, items: { type: array, items: integer } }
        const listOfValues = child instanceof PropArray && child.items instanceof Scalar;
        const nestedListOfValues =
          child instanceof PropArray && child.items instanceof Arr && child.items.itemsType instanceof Scalar;
        // a list of enum values is a leaf too — without it, motion's SchedulesGetRequest, where
        // it's the only property, collapses to an empty input type. see docs/FIXED.md #170
        //   e.g. (motion) include: { type: array, items: { type: string, enum: [workHours] } }
        // only when the enum has a legal GraphQL form; else it stays unselected, as before #170. #24
        const listOfEnumValues =
          child instanceof PropArray && child.items instanceof En && GqlUtils.isGqlEnum(child.items.schema);
        if (T.isPropScalar(child) || listOfValues || nestedListOfValues || listOfEnumValues) {
          newSelection.add(child.path());
        } else if (child instanceof PropEn) {
          // enum props are leaves too — without this, `>**` silently drops every enum field
          // (slack's `ok`-only stubs collapsed to zero types). see docs/FIXED.md #24
          newSelection.add(child.path());
        } else if (child instanceof PropCircRef) {
          // a cut cycle is a leaf: include its path so the commented field is emitted (in both the
          // SDL and the selection) instead of silently dropped. see docs/FIXED.md #10
          newSelection.add(child.path());
        } else if (child instanceof Scalar && child.parent instanceof Res) {
          // a response that is just a value, no object around it — a write answering `true` (adobe
          // commerce), or a token string (petstore `/user/login`):
          //   responses: { '200': { schema: { type: boolean } } }
          // Nothing to pick apart, so the value itself is the leaf. see docs/FIXED.md #32
          newSelection.add(child.path());
        } else if (child instanceof En && child.parent instanceof Res) {
          // a response that is just an enum value, no object around it — same shape as #32's bare
          // scalar, just enum-typed. see docs/FIXED.md #120
          newSelection.add(child.path());
        } else if (child instanceof Arr && child.parent instanceof Res && child.itemsType instanceof Scalar) {
          // the case above with a list around it — a response that is just an array of values,
          // no object around it (spotify's "check saved" endpoints answer `[true, false]`):
          //   responses: { '200': { schema: { type: array, items: { type: boolean } } } }
          // Nothing to pick apart, so the array itself is the leaf. see docs/FIXED.md #47
          newSelection.add(child.path());
        } else {
          // the value type is only known once the node is expanded, so the map check comes after
          this.gen.expand(child);
          // A map of plain values has nothing below it to select — the map itself is the leaf,
          // whether it hangs off a property (#70) or is the whole response (#92).
          //   e.g. (map-input-suffix.yaml) labels: { additionalProperties: { type: string } }  #70
          //   e.g. (github) get:/emojis: { additionalProperties: string }  #92
          // (whole values only — a cycle-cut value would select bare against a composite SDL type  #76)
          const mapUnderProp = child instanceof PropMap ? child.map : undefined;
          const mapAsResponse = child instanceof MapNode && child.parent instanceof Res ? child : undefined;
          const map = mapUnderProp ?? mapAsResponse;
          if (map?.valueType && T.isWholeMapValue(map.valueType)) {
            newSelection.add(child.path());
          }
        }
      });

      // a side of the op whose expansion found nothing selectable still has fields to write when
      // its only content is a free-form JSON object (asana: `data: $ref EmptyResponse` ->
      // `data: JSON`, emitted as an EMPTY invalid type before) — take those fields as the leaves.
      // Per side, not per op: a write whose body is selectable can still answer with an empty
      // object, and checking the op as a whole never fires for it. see docs/FIXED.md #32, #51
      const sides = T.isOp(root) ? root.children : [root];
      for (const side of sides) {
        if (Array.from(newSelection).some((p) => p.startsWith(side.path()))) {
          continue;
        }
        // scoped to an otherwise-empty side on purpose: doing it everywhere diverged the
        // selections of types shared across connectors. see docs/FIXED.md #32
        T.traverse(side, (child) => {
          if (child instanceof PropObj && _.isEmpty(child.obj?.props)) {
            newSelection.add(child.path());
          }
        });
      }
    });

    // finally remove the expanded paths from the selection
    return [...newSelection, ...selection.filter((p) => !expands.includes(p))];
  }
}
