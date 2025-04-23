import _ from 'lodash';
import { OasGen } from '../oasGen.js';
import { Composed, IType, Scalar, T } from '../nodes/internal.js';
import { OperationWriter } from './operationWriter.js';
import { PathCollector } from './pathCollector.js';
import { SchemaWriter } from './schemaWriter.js';

export class Writer {
  private pathCollector: PathCollector;
  private schemaWriter: SchemaWriter;
  private operationWriter: OperationWriter;
  public buffer: string[];

  constructor(public gen: OasGen) {
    this.buffer = [];
    this.pathCollector = new PathCollector(gen);
    this.schemaWriter = new SchemaWriter(gen);
    this.operationWriter = new OperationWriter(gen);
  }

  public write(input: string): Writer {
    this.buffer.push(input);
    return this;
  }

  public flush(): string {
    return this.buffer.join('');
  }

  public writeSchema(writer: Writer, types: Map<string, IType>, selection: string[]): void {
    const context = this.gen.context!;
    const generatedSet = context.generatedSet;

    this.schemaWriter.writeDirectives(writer);
    this.schemaWriter.writeJSONScalar(writer);

    types.forEach((type: IType) => {
      if (!generatedSet.has(type.id)) {
        type.generate(context, this, selection);
        generatedSet.add(type.id);
      }
    });

    const expanded = [...this.gen.paths];

    const queries = new Map(expanded.filter(([_k, type]) => type.id.startsWith('get:')));
    const mutations = new Map(expanded.filter(([_k, type]) => T.isMutationType(type)));

    this.operationWriter.writeQuery(context, writer, queries, selection);
    this.operationWriter.writeMutations(context, writer, mutations, selection);

    writer.flush();
  }

  public generate(selection: string[]): string[] {
    const pendingTypes: Map<string, IType> = new Map();

    selection = this.pathCollector.collectExpandedPaths(selection);

    for (const path of selection) {
      let collection = Array.from(this.gen.paths.values());
      let current: IType | undefined;
      let last: IType | undefined;

      let i = 0;
      const parts = path.split('>');
      do {
        const part = parts[i].replace(/#\/c\/s/g, '#/components/schemas');
        if (part === '*') {
          // remove the current path from the selection array
          selection = selection.filter((s) => s !== path);

          if (current && current instanceof Composed) {
            current!.consolidate(selection);
          }

          // add all the props from the current node and exit loop
          current?.props.forEach((child) => {
            if (T.isLeaf(child)) {
              selection.push(child.path());
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
        // TODO: this seems redundant, we've already walked the parent AND can be also contained in the context stack
        const parentType = PathCollector.findNonPropParent(current as IType);
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
      comp.consolidate(selection).forEach((id) => pendingTypes.delete(id));
    }

    this.writeSchema(this, pendingTypes, selection);
    return selection;
  }
}
