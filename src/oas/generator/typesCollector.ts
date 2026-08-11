import _ from 'lodash';
import { Composed } from '../nodes/comp.js';
import { Arr, IType, Prop, PropArray, PropCircRef, PropEn, PropObj, Res, Scalar, T } from '../nodes/internal.js';
import { OasGen } from '../oasGen.js';
import { Naming } from '../utils/naming.js';
import { SelectionPath } from '../utils/selectionPath.js';

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

      let i = 0;
      const parts = path.split('>');
      do {
        const part = Naming.expandRef(parts[i]);
        if (part === '*') {
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

    // One operation can reach the same schema through several routes, and each route builds its
    // own node for it. Cycle detection (#10) removes a field from a node when that field would
    // loop back to an ancestor of ITS route — so two nodes for the same schema can end up with
    // different fields. Only one of them is written to the output schema (the first one found),
    // but the connector selection is assembled from ALL routes: it can ask for a field the
    // written node doesn't have, and composition fails (SELECTED_FIELD_NOT_FOUND).
    //
    // e.g. confluence `get:/wiki/rest/api/content/{id}/restriction`: `Space` is reached twice —
    //   via `content`:      that route goes through Content, so Space's `homepage` was removed
    //   via `restrictions`: it doesn't, so `homepage` is kept — and that route's selection asks for it
    // both routes are written out in full in the issue entry.
    //
    // The routes are already spelled out in `expanded`, so for each removed field we look for a
    // selection path carrying the real field under the same type id, walk that path to its node,
    // and tell the writer to emit that version of the field (context.sdlPropOverrides — the TYPE
    // DEFINITION only; selections are left alone, each route keeps its own "field removed"
    // comment. Putting the field back into props re-created the loop cycle detection had just
    // broken: rover CIRCULAR_REFERENCE). Because the replacement comes FROM the selection, a
    // field nobody selects is never added (CONNECTORS_UNRESOLVED_FIELD, test_040 AdobeCommerce).
    // see docs/issues.md #13
    const context = this.gen.context!;
    for (const kept of pendingTypes.values()) {
      kept.props.forEach((prop, name) => {
        if (!(prop instanceof PropCircRef)) {
          return;
        }
        const donor = this.findSelectedFieldNode(kept, name, expanded);
        if (donor) {
          let overrides = context.sdlPropOverrides.get(kept);
          if (!overrides) {
            overrides = new Map();
            context.sdlPropOverrides.set(kept, overrides);
          }
          overrides.set(name, donor);
        }
      });
    }

    // first pass is to consolidate all Composed & Union nodes
    const composed: Array<Composed> = Array.from(pendingTypes.values())
      .filter((t) => t instanceof Composed)
      .map((t) => t as Composed);

    for (const comp of composed) {
      if (!comp.visited) comp.visit(context);
      comp.consolidate(expanded).forEach((id) => pendingTypes.delete(id));
    }

    // keep exactly the types the written schema references: confluence emitted `Label` with
    // nothing selecting it, box dropped `Folder--Mini` while still referencing it. see #26
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

    this.types = pendingTypes;
    this.expanded = expanded;
  }

  // Every type the written schema will point at, walked over each node's own dependencies()
  // from the selected operations' result/body. e.g. `getUser: User` + `User.address: Address`
  // reaches { User, Address }. see #26
  private collectReachable(expanded: string[]): Set<IType> {
    const context = this.gen.context!;
    const opIds = new Set(expanded.map((p) => p.split('>')[0]));

    const queue: IType[] = [];
    for (const op of this.gen.paths.values()) {
      if (opIds.has(op.id)) {
        const roots = [_.get(op, 'resultType'), _.get(op, 'body')] as Array<IType | undefined>;
        queue.push(...roots.filter((n): n is IType => !!n));
      }
    }

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

  // A selection path that carries the real `name` field under this type id (`>obj:type:X>prop:…:name>`),
  // walked to its node — the un-removed version of a field this node lost to a cycle cut. see #13
  private findSelectedFieldNode(kept: IType, name: string, expanded: string[]): IType | undefined {
    // selection paths abbreviate component refs (`path()` writes `#/c/s`); match that form
    const marker = `>${Naming.abbreviateRef(kept.id)}>`;
    for (const sel of expanded) {
      const at = sel.indexOf(marker);
      if (at < 0) {
        continue;
      }
      const segment = sel.slice(at + marker.length).split('>')[0];
      const isRealProp = segment.startsWith('prop:') && !segment.startsWith('prop:circular-ref');
      if (!isRealProp || !(segment.endsWith(':' + name) || segment.endsWith(':#' + name))) {
        continue;
      }
      const donorPath = sel.slice(0, at + marker.length + segment.length);
      const stack = new PathsCollector(this.gen).collectPaths(donorPath, Array.from(this.gen.paths.values()));
      const donor = stack[stack.length - 1];
      if (donor && !(donor instanceof PropCircRef)) {
        return donor;
      }
    }
    return undefined;
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
    const parts = input.split('>');
    const results: string[] = [];
    for (let i = 1; i <= parts.length; i++) {
      results.push(parts.slice(0, i).join('>'));
    }
    return results;
  }

  public collectPaths(path: string, collection: IType[]): IType[] {
    const stack: IType[] = [];
    let current: IType | undefined;
    let last: IType | undefined;

    let i = 0;
    const parts = path.split('>');
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
    const expands = selection.filter((p) => p.endsWith('>**'));
    const filtered = expands.map((p) => p.replace('>**', ''));

    const paths = Array.from(this.gen.paths.values());
    const nodes = filtered.map((p) => this.collectPaths(p, paths));

    nodes.forEach((stack) => {
      const root = _.last(stack)!;
      T.traverse(root, (child) => {
        if (T.isPropScalar(child) || (child instanceof PropArray && child.items instanceof Scalar)) {
          newSelection.add(child.path());
        } else if (child instanceof PropEn) {
          // enum props are leaves too — without this, `>**` silently drops every enum field
          // (slack's `ok`-only stubs collapsed to zero types). see docs/issues.md #24
          newSelection.add(child.path());
        } else if (child instanceof PropCircRef) {
          // a cut cycle is a leaf: include its path so the commented field is emitted (in both the
          // SDL and the selection) instead of silently dropped. see docs/issues.md #10
          newSelection.add(child.path());
        } else if (child instanceof Scalar && child.parent instanceof Res) {
          // a response that is just a value, no object around it — a write answering `true` (adobe
          // commerce), or a token string (petstore `/user/login`):
          //   responses: { '200': { schema: { type: boolean } } }
          // Nothing to pick apart, so the value itself is the leaf. see docs/issues.md #32
          newSelection.add(child.path());
        } else if (child instanceof Arr && child.parent instanceof Res && child.itemsType instanceof Scalar) {
          // the case above with a list around it — a response that is just an array of values,
          // no object around it (spotify's "check saved" endpoints answer `[true, false]`):
          //   responses: { '200': { schema: { type: array, items: { type: boolean } } } }
          // Nothing to pick apart, so the array itself is the leaf. see docs/issues.md #47
          newSelection.add(child.path());
        } else {
          this.gen.expand(child);
        }
      });

      // a side of the op whose expansion found nothing selectable still has fields to write when
      // its only content is a free-form JSON object (asana: `data: $ref EmptyResponse` ->
      // `data: JSON`, emitted as an EMPTY invalid type before) — take those fields as the leaves.
      // Per side, not per op: a write whose body is selectable can still answer with an empty
      // object, and checking the op as a whole never fires for it. see docs/issues.md #32, #51
      const sides = T.isOp(root) ? root.children : [root];
      for (const side of sides) {
        if (Array.from(newSelection).some((p) => p.startsWith(side.path()))) {
          continue;
        }
        // scoped to an otherwise-empty side on purpose: doing it everywhere diverged the
        // selections of types shared across connectors. see docs/issues.md #32
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
