import _ from 'lodash';
import { Composed } from '../nodes/comp.js';
import { IType, Prop, PropArray, Scalar, T } from '../nodes/internal.js';
import { OasGen } from '../oasGen.js';

export class TypesCollector {
  types: Map<string, IType> = new Map();
  expanded: string[] = []

  constructor(private gen: OasGen) {
  }

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
        const part = parts[i].replace(/#\/c\/s/g, '#/components/schemas');
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
      const deps: IType[] = _.invoke(current, 'dependencies');
      if (deps) {
        deps.filter((i) => !pendingTypes.has(i.id)).forEach((i) => pendingTypes.set(i.id, i));
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
          .forEach((dep) => pendingTypes.set(dep.id, dep));
      }
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
}

// import _ from 'lodash';
// import { OasGen } from '../oasGen.js';
// import { Composed, IType, Prop, PropArray, Scalar, Type, T } from '../nodes/internal.js';

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
      const part = parts[i].replace(/#\/c\/s/g, '#/components/schemas');

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
        } else {
          this.gen.expand(child);
        }
      });
    });

    // finally remove the expanded paths from the selection
    return [...newSelection, ...selection.filter((p) => !expands.includes(p))];
  }

/*
  public traverseTree(current: IType, selection: string[], pending: Map<string, IType>) {
    // we might be in a node far from the root, so we need to traverse upwards
    // as well and add the props that we can find on the way
    const source = current as Type;

    source
      .ancestors()
      .filter((t) => t instanceof Prop)
      .map((p) => T.findNonPropParent(p))
      .forEach((parent) => pending.set(parent.id, parent));

    T.traverse(source, (child) => {
      if (T.isLeaf(child)) {
        // this is a weird take but if the child is an array of scalars
        // then we want to avoid adding it twice
        if (T.isLeaf(child.parent!)) {
          return;
        }
        selection.push(child.path());

        const parentType = T.findNonPropParent(child);
        if (!pending.has(parentType.id)) {
          pending.set(parentType.id, parentType);
        }
      } else {
        this.gen.expand(child);

        if (child instanceof Composed) {
          child.consolidate(selection);
        }
      }
    });
  }
*/
}
