import _ from 'lodash';
import Oas from 'oas';
import { ServerObject } from 'oas/types';
import { OasContext } from '../oasContext.js';
import { OasGen } from '../oasGen.js';
import { Body, CircularRef, Post } from '../nodes/internal.js';
import { Composed } from '../nodes/internal.js';
import { Get } from '../nodes/internal.js';
import { Obj } from '../nodes/internal.js';
import { Param } from '../nodes/internal.js';
import { Prop } from '../nodes/internal.js';
import { PropArray } from '../nodes/internal.js';
import { PropScalar } from '../nodes/internal.js';
import { Type } from '../nodes/internal.js';
import { Union } from '../nodes/internal.js';
import { Naming } from '../utils/naming.js';
import { T } from '../utils/typeUtils.js';
import { IType } from '../nodes/internal.js';

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

  public writeSchema(writer: Writer, types: Map<string, IType>, inputs: Map<string, IType>, selection: string[]): void {
    const context = this.generator.context!;
    const generatedSet = context.generatedSet;
    // generatedSet.clear();

    this.writeDirectives(writer);
    this.writeJSONScalar(writer);

    types.forEach((type: IType) => {
      if (!generatedSet.has('type:' + type.id)) {
        type.generate(context, this, selection);
        generatedSet.add('type:' + type.id);
      }
    });

    inputs.forEach((type: IType) => {
      if (!generatedSet.has('input:' + type.id)) {
        type.generate(context, this, selection);
        generatedSet.add('input:' + type.id);
      }
    });

    const expanded = [...this.generator.paths];

    const gets = new Map(expanded.filter(([_k, type]) => type.id.startsWith('get:')));
    const posts = new Map(expanded.filter(([_k, type]) => type.id.startsWith('post:')));

    this.writeQuery(context, writer, gets, selection);
    this.writeMutations(context, writer, posts, selection);
    writer.flush();
  }

  public generate(selection: string[]) {
    const pendingTypes: Map<string, IType> = new Map();
    const pendingInputs: Map<string, IType> = new Map();

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
          throw new Error('Could not find type: ' + part + ' from ' + path + ', last: ' + last?.pathToRoot());
        }

        // make sure we expand it before we move on to the next part
        this.generator.expand(current);
        last = current;

        collection = Array.from(current!.children.values()) || Array.from(current!.props.values()) || [];

        i++;
      } while (i < parts.length);

      if (current) {
        // TODO: this seems redundant, we've already walked the parent AND can be also contained in the context stack
        const parentType = Writer.findNonPropParent(current as IType);

        if (!pendingTypes.has(parentType.id)) {
          pendingTypes.set(parentType.id, parentType);
        }

        parentType
          .ancestors()
          .filter((t) => !pendingTypes.has(t.id) && this.isContainer(t))
          .forEach((dep) => {
            // TODO: potential merge needed?
            pendingTypes.set(dep.id, dep);
          });
      }
    }

    // process any POST paths, as we need to add the Body as a pendingInputs item
    /*Array.from(this.generator.paths.values())
      .filter((t) => t instanceof Post)
      .forEach((path) => {
        if (path.body && !pendingInputs.has(path.body.id))
          pendingInputs.set(path.body.id, path.body);

        if (path.body) {
          this.generator.expand(path.body!);

          const queue: IType[] = Array.from(path.body!.children.values());

          while (queue.length > 0) {
            const node = queue.shift()!;
            const isContainer = this.isContainer(node);

            if (isContainer && !pendingInputs.has(node.id)) {
              pendingInputs.set(node.id, node);
            }

            this.generator.expand(node);
            queue.push(...node.children);
          }
        }
      });*/

    // TODO: do we need to do the same for the pending inputs?
    if (!_.isEmpty(pendingTypes)) {
      // first pass is to consolidate all Composed & Union nodes
      const composed: Array<Composed | Union> = Array.from(pendingTypes.values())
        .filter((t) => t instanceof Composed || t instanceof Union)
        .map((t) => t as Composed);

      for (const comp of composed) {
        comp.consolidate(selection).forEach((id) => pendingTypes.delete(id));
      }

      this.writeSchema(this, pendingTypes, pendingInputs, selection);
    }
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
    const op = type as unknown as Get | Post; // assume type is GetOp
    let spacing = ' '.repeat(indent + 4);
    writer.append(spacing).append('@connect(\n');

    spacing = ' '.repeat(indent + 6);
    writer.append(spacing).append('source: "api"\n').append(spacing).append('http: ');

    this.requestMethod(context, writer, op, selection);

    writer.append('\n').append(spacing).append('selection: """\n');

    if (op.resultType) {
      this.writeSelection(context, writer, op.resultType, selection);
    }

    writer.append(spacing).append('"""\n');
    spacing = ' '.repeat(indent + 4);
    writer.append(spacing).append(')\n');
  }

  private requestMethod(context: OasContext, writer: Writer, op: Get | Post, selection: string[]): void {
    // replace every {elem} in the path for {$args.elem}
    const verb = op.id.startsWith('get:') ? 'GET' : 'POST';
    writer.append(`{ ${verb}:`).append('"' + op.operation.path.replace(/\{([a-zA-Z0-9]+)\}/g, '{$args.$1}'));

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
        if (T.isPropScalar(child) || (child instanceof PropArray && child.items instanceof PropScalar)) {
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
