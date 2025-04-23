import _ from 'lodash';
import { OasContext } from '../oasContext.js';
import { OasGen } from '../oasGen.js';
import { Body, IType, Op, Param, Type } from '../nodes/internal.js';
import { Naming } from '../utils/naming.js';
import { Writer } from './writer.js';

export class OperationWriter {
  constructor(private gen: OasGen) {}

  public writeQuery(context: OasContext, writer: Writer, collected: Map<string, IType>, selection: string[]): void {
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

  public writeMutations(context: OasContext, writer: Writer, collected: Map<string, IType>, selection: string[]): void {
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

  public writeConnector(context: OasContext, writer: Writer, type: IType, selection: string[]): void {
    const indent = 0;
    const op = type as unknown as Op; // assume type is GetOp
    let spacing = ' '.repeat(indent + 4);
    writer.write(spacing).write('@connect(\n');

    spacing = ' '.repeat(indent + 6);
    writer.write(spacing).write('source: "api"\n').write(spacing).write('http: ');

    this.requestMethod(context, writer, op, selection);

    writer.write('\n').write(spacing).write('selection: """\n');

    if (_.has(op, 'resultType')) {
      // scalar types don't need to be generated?
      this.writeSelection(context, writer, _.get(op, 'resultType') as Type, selection);
    }

    writer.write(spacing).write('"""\n');
    spacing = ' '.repeat(indent + 4);
    writer.write(spacing).write(')\n');
  }

  private requestMethod(context: OasContext, writer: Writer, op: Op, selection: string[]): void {
    // replace every {elem} in the path for {$args.elem}
    const verb = op.verb;
    writer.write(`{ ${verb}: `).write('"' + op.operation.path.replace(/\{([a-zA-Z0-9]+)\}/g, '{$args.$1}'));

    if (op.params.length > 0) {
      const params = op.params.filter((p: Param) => {
        return p.required && p.parameter.in && p.parameter.in.toLowerCase() === 'query';
      });

      if (params.length > 0) {
        writer.write('?' + params.map((p: Param) => `${p.name}={$args.${Naming.genParamName(p.name)}}`).join('&'));
      }
      const headers = op.operation.getParameters().filter((p) => p.in && p.in.toLowerCase() === 'header');

      writer.write('"\n');

      if (headers.length > 0) {
        let spacing = ' '.repeat(6);
        writer.write(spacing + 'headers: [\n');
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

          writer.write(spacing + `{ name: "${p.name}", value: "${value}" }\n`);
        }

        spacing = ' '.repeat(6);
        writer.write(spacing + ']');
      }
    } else {
      writer.write('"');
    }

    if (_.has(op, 'body')) {
      const body = op.body as Body;
      this.writeBodySelection(context, writer, body, selection);
    }

    writer.write('}');
  }

  private writeSelection(context: OasContext, writer: Writer, type: IType, selection: string[]): void {
    context.indent = 6;
    type.select(context, writer, selection);
  }

  private writeBodySelection(context: OasContext, writer: Writer, body: Body, selection: string[]): void {
    writer.write(',\n');
    context.indent = 6;
    if (body) {
      body.select(context, writer, selection);
    }
  }
}
