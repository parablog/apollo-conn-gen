import _ from 'lodash';
import Oas from 'oas';
import { ServerObject } from 'oas/types';
import { OasContext } from '../oasContext.js';
import { OasGen } from '../oasGen.js';
import {
  IType,
  Type,
  Union,
  Body,
  CircularRef,
  Op,
  PropScalar,
  Composed,
  Obj,
  Prop,
  Param,
  PropArray,
} from '../nodes/internal.js';
import { Naming } from '../utils/naming.js';
import { T } from '../nodes/typeUtils.js';
import { Scalar } from '../nodes/internal.js';

export class Writer {
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

  public buffer: string[];

  constructor(public generator: OasGen) {
    this.buffer = [];
  }

  public write(input: string): Writer {
    this.buffer.push(input);
    return this;
  }

  public append(input: string): Writer {
    this.buffer.push(input);
    return this;
  }

  public flush(): string {
    return this.buffer.join('');
  }

  public writeSchema(writer: Writer, types: Map<string, IType>, selection: string[]): void {
    const context = this.generator.context!;
    const generatedSet = context.generatedSet;

    this.writeDirectives(writer);
    this.writeJSONScalar(writer);

    types.forEach((type: IType) => {
      if (!generatedSet.has(type.id)) {
        type.generate(context, this, selection);
        generatedSet.add(type.id);
      }
    });

    const expanded = [...this.generator.paths];

    const queries = new Map(expanded.filter(([_k, type]) => type.id.startsWith('get:')));
    const mutations = new Map(expanded.filter(([_k, type]) => T.isMutationType(type)));

    this.writeQuery(context, writer, queries, selection);
    this.writeMutations(context, writer, mutations, selection);
    writer.flush();
  }

  public generate(selection: string[]): string[] {
    const pendingTypes: Map<string, IType> = new Map();
    selection = this.collectExpandedPaths(selection);

    for (const path of selection) {
      let collection = Array.from(this.generator.paths.values());
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
          throw new Error('Could not find type: ' + part + ' from ' + path + '\nlast:\n' + last?.pathToRoot() + "\ntree: " + tree);
        }

        // make sure we expand it before we move on to the next part
        this.generator.expand(current);
        last = current;

        collection = Array.from(current!.children.values()) || Array.from(current!.props.values()) || [];
        i++;
      } while (i < parts.length);

      if (current && !(current instanceof Scalar)) {
        // TODO: this seems redundant, we've already walked the parent AND can be also contained in the context stack
        const parentType = Writer.findNonPropParent(current as IType);
        if (!pendingTypes.has(parentType.id)) {
          pendingTypes.set(parentType.id, parentType);
        }

        // add all ancestors (of the parent of the prop) that are containers so they are generated accordingly
        parentType.ancestors()
          .filter((t) => !pendingTypes.has(t.id) && this.isContainer(t))
          .forEach((dep) => pendingTypes.set(dep.id, dep));
      }
    }

    // first pass is to consolidate all Composed & Union nodes
    const composed: Array<Composed> = Array.from(pendingTypes.values())
      .filter((t) => t instanceof Composed)
      .map((t) => t as Composed);

    const context = this.generator.context!;
    for (const comp of composed) {
      if (!comp.visited) comp.visit(context);
      comp.consolidate(selection).forEach((id) => pendingTypes.delete(id));
    }

    this.writeSchema(this, pendingTypes, selection);
    return selection;
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
      this.generator.expand(current);
      last = current;

      collection = Array.from(current!.children.values()) || Array.from(current!.props.values()) || [];

      stack.push(current);
      i++;
    } while (i < parts.length);

    return stack;
  }

  private writeJSONScalar(writer: Writer): void {
    writer.write('\nscalar JSON\n\n');
  }

  private writeQuery(context: OasContext, writer: Writer, collected: Map<string, IType>, selection: string[]): void {
    const selectionSet = new Set<string>(selection.map((s) => s.split('>')[0]));

    const paths = Array.from(collected.values()).filter((path) => selectionSet.has(path.id));
    if (_.isEmpty(paths)) return;

    writer.write('type Query {\n');

    for (const path of paths) {
      path.generate(context, writer, []);
      this.writeConnector(context, writer, path, selection);
      context.generatedSet.add(path.id);
    }

    writer.write('}\n\n');
  }

  private writeConnector(context: OasContext, writer: Writer, type: IType, selection: string[]): void {
    const indent = 0;
    const op = type as unknown as Op; // assume type is GetOp
    let spacing = ' '.repeat(indent + 4);
    writer.append(spacing).append('@connect(\n');

    spacing = ' '.repeat(indent + 6);
    writer.append(spacing).append('source: "api"\n').append(spacing).append('http: ');

    this.requestMethod(context, writer, op, selection);

    writer.append('\n').append(spacing).append('selection: """\n');

    if (_.has(op, 'resultType')) {
      // scalar types don't need to be generated?
      this.writeSelection(context, writer, _.get(op, 'resultType') as Type, selection);
    }

    writer.append(spacing).append('"""\n');
    spacing = ' '.repeat(indent + 4);
    writer.append(spacing).append(')\n');
  }

  private requestMethod(context: OasContext, writer: Writer, op: Op, selection: string[]): void {
    // replace every {elem} in the path for {$args.elem}
    const verb = op.verb;
    writer.append(`{ ${verb}: `).append('"' + op.operation.path.replace(/\{([a-zA-Z0-9]+)\}/g, '{$args.$1}'));

    if (op.params.length > 0) {
      const params = op.params.filter((p: Param) => {
        return p.required && p.parameter.in && p.parameter.in.toLowerCase() === 'query';
      });

      if (params.length > 0) {
        writer.append('?' + params.map((p: Param) => `${p.name}={$args.${Naming.genParamName(p.name)}}`).join('&'));
      }
      const headers = op.operation.getParameters().filter((p) => p.in && p.in.toLowerCase() === 'header');

      writer.append('"\n');

      if (headers.length > 0) {
        let spacing = ' '.repeat(6);
        writer.append(spacing + 'headers: [\n');
        spacing = ' '.repeat(8);

        for (const p of headers) {
          let value: string | null = null;

          if (p.example != null) {
            value = p.example.toString();
          }

          if (p.examples && Object.keys(p.examples).length > 0) {
            value = Object.keys(p.examples).join(',');
          }

          if (value == null) {
            value = '<placeholder>';
          }

          writer.append(spacing + `{ name: "${p.name}", value: "${value}" }\n`);
        }

        spacing = ' '.repeat(6);
        writer.append(spacing + ']');
      }
    } else {
      writer.append('"');
    }

    if (_.has(op, 'body')) {
      const body = op.body as Body;
      this.writeBodySelection(context, writer, body, selection);
    }

    writer.append('}');
    // const verb = op.id.startsWith('get:') ? 'GET' : 'POST';
    // return `{ ${verb}: ${builder} }`;
  }

  private writeSelection(context: OasContext, writer: Writer, type: IType, selection: string[]): void {
    context.indent = 6;
    type.select(context, writer, selection);
  }

  private writeDirectives(writer: Writer): void {
    const api: Oas = this.generator.parser;
    const host = this.getServerUrl(api.getDefinition().servers?.[0]);
    writer
      .append('extend schema\n')
      .append('  @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key"])\n')
      .append('  @link(\n')
      .append('    url: "https://specs.apollo.dev/connect/v0.1"\n')
      .append('    import: ["@connect", "@source"]\n')
      .append('  )\n')
      .append('  @source(name: "api", http: { baseURL: "')
      .append(host)
      .append('" })\n\n');
  }

  private getServerUrl(server: ServerObject | undefined): string {
    if (!server) {
      return 'http://localhost:4010';
    }
    let url: string = server.url;
    if (server.variables) {
      for (const key in server.variables) {
        url = url.replace('{' + key + '}', server.variables[key].default);
      }
    }
    return url;
  }

  private traverseTree(current: IType, selection: string[], pending: Map<string, IType>) {
    // we might be in a node far from the root, so we need to traverse upwards
    // as well and add the props that we can find on the way
    const source = current as Type;

    source
      .ancestors()
      .filter((t) => t instanceof Prop)
      .map((p) => Writer.findNonPropParent(p))
      .forEach((parent) => pending.set(parent.id, parent));

    T.traverse(source, (child) => {
      if (T.isLeaf(child)) {
        // this is a weird take but if the child is an array of scalars
        // then we want to avoid adding it twice
        if (T.isLeaf(child.parent!)) {
          return;
        }
        selection.push(child.path());

        const parentType = Writer.findNonPropParent(child);
        if (!pending.has(parentType.id)) {
          pending.set(parentType.id, parentType);
        }
      } else {
        this.generator.expand(child);

        if (child instanceof Composed) {
          child.consolidate(selection);
        }
      }
    });
  }

  private isContainer(type: IType) {
    return type instanceof Obj || type instanceof Union || type instanceof Composed || type instanceof CircularRef;
  }

  private collectExpandedPaths(selection: string[]) {
    const newSelection = new Set<string>();
    const expands = selection.filter((p) => p.endsWith('>**'));
    const filtered = expands.map((p) => p.replace('>**', ''));

    const paths = Array.from(this.generator.paths.values());
    const nodes = filtered.map((p) => this.collectPaths(p, paths));

    nodes.forEach((stack) => {
      const root = _.last(stack)!;
      T.traverse(root, (child) => {
        if (T.isPropScalar(child) || (child instanceof PropArray && child.items instanceof Scalar)) {
          newSelection.add(child.path());
        } else {
          this.generator.expand(child);
        }
      });
    });

    // finally remove the expanded paths from the selection
    return [...newSelection, ...selection.filter((p) => !expands.includes(p))];
  }

  private writeMutations(
    context: OasContext,
    writer: Writer,
    collected: Map<string, IType>,
    selection: string[],
  ): void {
    const selectionSet = new Set<string>(selection.map((s) => s.split('>')[0]));

    const paths = Array.from(collected.values()).filter((path) => selectionSet.has(path.id));
    if (_.isEmpty(paths)) return;

    writer.write('type Mutation {\n');

    for (const path of paths) {
      path.generate(context, writer, []);
      this.writeConnector(context, writer, path, selection);
      context.generatedSet.add(path.id);
    }

    writer.write('}\n\n');
  }

  private writeBodySelection(context: OasContext, writer: Writer, body: Body, selection: string[]): void {
    writer.append(',\n');
    context.indent = 6;
    // let spacing = ' '.repeat(6);

    if (body) {
      body.select(context, writer, selection);
    }
    /*writer.append(spacing + 'body: """\n');

    // TODO: writer.append(spacing + '$args.input' + '\n');
    // we should check if we have no selection for body? or else just send everything?
    context.indent = 6;
    body.select(context, writer, selection);

    writer.append(spacing + '"""\n' + ' '.repeat(5));*/
  }
}
