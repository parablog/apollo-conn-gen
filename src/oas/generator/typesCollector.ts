import _ from 'lodash';
import { Composed } from '../nodes/comp.js';
import { IType, Prop, PropArray, PropCircRef, PropEn, Scalar, T } from '../nodes/internal.js';
import { OasGen } from '../oasGen.js';
import { Naming } from '../utils/naming.js';

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

        current = collection.find((t) => t.id === part);
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

      // optional hook -- if the type in question has deps, add them here
      const deps: IType[] = _.invoke(current, 'dependencies', [this.gen.context]);
      if (deps) {
        deps
          .filter((i) => !pendingTypes.has(i.id))
          .forEach((i) => {
            pendingTypes.set(i.id, i);
          });
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

    // One operation can reach the same schema through several routes, and each route builds its
    // own node for it. Cycle detection (#10) removes a field from a node when that field would
    // loop back to an ancestor of ITS route — so two nodes for the same schema can end up with
    // different fields. Only one of them is written to the output schema (the first one found),
    // but the connector selection is assembled from ALL routes: it can ask for a field the
    // written node doesn't have, and composition fails (SELECTED_FIELD_NOT_FOUND).
    //
    // e.g. (confluence, one op): `Space` is reached twice —
    //   via Content: its `history` field was removed (history loops back to Content)
    //   via Results: `history` kept — and that route's selection asks for it
    //
    // The routes are already spelled out in `expanded`, so for each removed field we look for a
    // selection path carrying the real field under the same type id, walk that path to its node,
    // and tell the writer to emit that version of the field (context.sdlPropOverrides — the TYPE
    // DEFINITION only; selections are left alone, each route keeps its own "field removed"
    // comment. Putting the field back into props re-created the loop cycle detection had just
    // broken: rover CIRCULAR_REFERENCE). Because the replacement comes FROM the selection, a
    // field nobody selects is never added (CONNECTORS_UNRESOLVED_FIELD, test_040 AdobeCommerce).
    // see docs/issues.md #13
    const context0 = this.gen.context!;
    for (const kept of pendingTypes.values()) {
      kept.props.forEach((prop, name) => {
        if (!(prop instanceof PropCircRef)) {
          return;
        }
        const donor = this.findSelectedFieldNode(kept, name, expanded);
        if (donor) {
          let overrides = context0.sdlPropOverrides.get(kept);
          if (!overrides) {
            overrides = new Map();
            context0.sdlPropOverrides.set(kept, overrides);
          }
          overrides.set(name, donor);
        }
      });
    }

    // first pass is to consolidate all Composed & Union nodes
    const composed: Array<Composed> = Array.from(pendingTypes.values())
      .filter((t) => t instanceof Composed)
      .map((t) => t as Composed);

    const context = this.gen.context!;
    for (const comp of composed) {
      if (!comp.visited) comp.visit(context);
      comp.consolidate(expanded).forEach((id) => pendingTypes.delete(id));
    }

    this.types = pendingTypes;
    this.expanded = expanded;
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

      current = collection.find((t) => t.id === part);
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
        } else {
          this.gen.expand(child);
        }
      });
    });

    // finally remove the expanded paths from the selection
    return [...newSelection, ...selection.filter((p) => !expands.includes(p))];
  }
}
