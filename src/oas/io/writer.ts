import _ from 'lodash';
import Oas from 'oas';
import { ServerObject } from 'oas/types';
import { OasContext } from '../oasContext.js';
import { OasGen } from '../oasGen.js';
import { CircularRef } from '../nodes/circularRef.js';
import { Composed } from '../nodes/comp.js';
import { Get } from '../nodes/get.js';
import { Obj } from '../nodes/obj.js';
import { Param } from '../nodes/param/param.js';
import { Prop } from '../nodes/props/prop.js';
import { PropArray } from '../nodes/props/propArray.js';
import { PropScalar } from '../nodes/props/propScalar.js';
import { Type } from '../nodes/type.js';
import { Union } from '../nodes/union.js';
import { Naming } from '../utils/naming.js';
import { T } from '../utils/typeUtils.js';
import { IType } from '../nodes/iType.js';

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

  public writeSchema(writer: Writer, pending: Map<string, IType>, selection: string[]): void {
    const context = this.generator.context!;
    const generatedSet = context.generatedSet;
    // generatedSet.clear();

    this.writeDirectives(writer);
    this.writeJSONScalar(writer);

    pending.forEach((type: IType) => {
      if (!generatedSet.has(type.id)) {
        type.generate(context, this, selection);
        generatedSet.add(type.id);
      }
    });

    // TODO: Pending
    // const counter = new RefCounter(this.context);
    // counter.addAll(this.collected);

    // const refs = counter.getCount();
    // this.printRefs(refs);

    // for (const type of this.context.types.ts.values()) {
    //   if (counter.getCount().has(type.name)) {
    //     await type.generate(this.context, writer);
    //     generatedSet.add(type.name);
    //   }
    // }

    this.writeQuery(context, writer, this.generator.paths, selection);
    writer.flush();
  }

  public generate(selection: string[]) {
    const pending: Map<string, IType> = new Map();

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

          if (current instanceof Composed) {
            current.consolidate(selection);
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
        // TODO: this seems redundant, we've already walked the parent AND can be also
        // contained in the context stack
        const parentType = Writer.findNonPropParent(current as IType);

        if (!pending.has(parentType.id)) {
          pending.set(parentType.id, parentType);
        }

        parentType
          .ancestors()
          .filter((t) => !pending.has(t.id) && this.isContainer(t))
          .forEach((dep) => {
            // TODO: potential merge needed?
            pending.set(dep.id, dep);
          });
      }
    }

    if (!_.isEmpty(pending)) {
      // first pass is to consolidate all Composed & Union nodes
      const composed: Array<Composed | Union> = Array.from(pending.values())
        .filter((t) => t instanceof Composed || t instanceof Union)
        .map((t) => t as Composed);

      for (const comp of composed) {
        comp.consolidate(selection).forEach((id) => pending.delete(id));
      }

      this.writeSchema(this, pending, selection);
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
    writer.write('type Query {\n');

    const selectionSet = new Set<string>(selection.map((s) => s.split('>')[0]));

    const paths = Array.from(collected.values()).filter((path) => selectionSet.has(path.id));

    for (const path of paths) {
      path.generate(context, writer, []);
      this.writeConnector(context, writer, path, selection);
      context.generatedSet.add(path.id);
    }

    writer.write('}\n\n');
  }

  private writeConnector(context: OasContext, writer: Writer, type: IType, selection: string[]): void {
    const indent = 0;
    const get = type as unknown as Get; // assume type is GetOp
    let spacing = ' '.repeat(indent + 4);
    writer.append(spacing).append('@connect(\n');

    const request = this.buildRequestMethodAndArgs(get);
    spacing = ' '.repeat(indent + 6);
    writer
      .append(spacing)
      .append('source: "api"\n')
      .append(spacing)
      .append('http: ' + request + '\n')
      .append(spacing)
      .append('selection: """\n');

    if (get.resultType) {
      this.writeSelection(context, writer, get.resultType, selection);
    }

    writer.append(spacing).append('"""\n');
    spacing = ' '.repeat(indent + 4);
    writer.append(spacing).append(')\n');
  }

  private buildRequestMethodAndArgs(get: Get): string {
    let builder = '';

    builder += '"' + get.operation.path.replace(/\{([a-zA-Z0-9]+)\}/g, '{$args.$1}');

    if (get.params.length > 0) {
      const params = get.params.filter((p: Param) => {
        return p.required && p.parameter.in && p.parameter.in.toLowerCase() === 'query';
      });

      if (params.length > 0) {
        builder += '?' + params.map((p: Param) => `${p.name}={$args.${Naming.genParamName(p.name)}}`).join('&');
      }
      const headers = get.operation.getParameters().filter((p) => p.in && p.in.toLowerCase() === 'header');

      builder += '"\n';

      if (headers.length > 0) {
        let spacing = ' '.repeat(6);
        builder += spacing + 'headers: [\n';
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

          builder += spacing + `{ name: "${p.name}", value: "${value}" }\n`;
        }

        spacing = ' '.repeat(6);
        builder += spacing + ']';
      }
    } else {
      builder += '"';
    }

    return `{ GET: ${builder} }`;
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
    /*.map(stack => _.last(stack)!.id)
      .filter(id => selection.includes(id))
      .forEach(id => newSelection.add(id));*/

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
}
