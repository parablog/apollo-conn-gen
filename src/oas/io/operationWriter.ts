import _ from 'lodash';
import { OasContext } from '../oasContext.js';
import { OasGen } from '../oasGen.js';
import { Body, IType, Op, Param, Res, T, Type } from '../nodes/internal.js';
import { Naming } from '../utils/naming.js';
import { Writer } from './writer.js';
import { DEFAULT_VERSIONS, meetsMinimum } from '../../versions.js';
import { warn } from '../log/trace.js';

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

    this.requestMethod(context, writer, op, selection, indent);

    writer.write('\n').write(spacing).write('selection: """\n');

    if (_.has(op, 'resultType')) {
      // scalar types don't need to be generated?
      this.writeSelection(context, writer, _.get(op, 'resultType') as Type, selection);
    }

    writer.write(spacing).write('"""\n');

    this.writeErrors(context, writer, op, indent);

    spacing = ' '.repeat(indent + 4);
    writer.write(spacing).write(')\n');
  }

  // R4 (opt-in): emit `errors: { extensions: """statusCode: $status""" }` to surface the HTTP status
  // in the GraphQL error extensions, for operations that document HTTP error responses. errors is a
  // connect v0.2+ feature; below that we skip with a logged downgrade rather than emit invalid output.
  private writeErrors(context: OasContext, writer: Writer, op: Op, indent: number): void {
    if (!context.generateOptions?.emitConnectorErrors || !this.hasDocumentedErrors(op)) {
      return;
    }

    const version = this.gen.options.connectorSpecVersion || DEFAULT_VERSIONS.connectorSpecVersion;
    if (!meetsMinimum(version, 'v0.2')) {
      warn(
        context,
        '[errors]',
        `@connect(errors:) requires connect v0.2, but target is ${version} — not emitted for ${op.verb} ${op.operation.path}`,
      );
      return;
    }

    const outer = ' '.repeat(indent + 6);
    const inner = ' '.repeat(indent + 6);
    writer
      .write(outer)
      .write('errors: { extensions: """\n')
      .write(inner)
      .write('statusCode: $status\n')
      .write(outer)
      .write('""" }\n');
  }

  // True when the operation documents an HTTP error response. Accepts both concrete numeric statuses
  // (4xx/5xx) and the OAS range keys `4XX`/`5XX` (case-insensitive). The `default` key is excluded —
  // it also covers 2xx/3xx, so it is not specifically an error indicator.
  private hasDocumentedErrors(op: Op): boolean {
    return op.operation.getResponseStatusCodes().some((code: string) => /^[45](\d\d|XX)$/i.test(code));
  }

  private requestMethod(context: OasContext, writer: Writer, op: Op, selection: string[], indent: number): void {
    // template each {elem} as {$args.<sanitised>} (the arg name), not the raw OAS key. see docs/issues.md #2
    const verb = op.verb;
    const templatedPath = op.operation.path.replace(
      /\{([^}]+)\}/g,
      (_m, name) => `{$args.${Naming.genParamName(name)}}`,
    );
    writer.write(`{ ${verb}: `).write('"' + templatedPath + '"');

    if (op.params.length > 0) {
      // we now include all query params, not just required ones. if they are not set,
      // then the connectors will not include them in the request.
      let queryParams = op.params.filter((p: Param) => {
        return p.parameter.in && p.parameter.in.toLowerCase() === 'query';
      });

      // Skip optional params if skipOptionalArgs is true
      if (context.generateOptions?.skipOptionalArgs) {
        queryParams = queryParams.filter((p: Param) => p.required);
      }

      if (queryParams.length > 0) {
        writer.write('\n');
        let spacing = ' '.repeat(6);

        writer.write(spacing).write(`queryParams: """\n`);
        spacing = ' '.repeat(8);
        writer.write(spacing).write(`$args {\n`);
        spacing = ' '.repeat(10);
        for (const p of queryParams) {
          writer.write(spacing).write(`"${p.name}": ${Naming.genParamName(p.name)}\n`);
        }
        spacing = ' '.repeat(8);
        writer.write(spacing).write('}\n');
        spacing = ' '.repeat(6);
        writer.write(spacing).write('"""\n');
      }

      const headers = op.operation.getParameters().filter((p) => p.in && p.in.toLowerCase() === 'header');

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
    }

    if (_.has(op, 'body')) {
      const body = op.body as Body;
      this.writeBodySelection(context, writer, body, selection);
    }

    writer.write('}');
  }

  private writeSelection(context: OasContext, writer: Writer, type: IType, selection: string[]): void {
    context.indent = 6;

    // R10: in reusable-mappings mode the @connect selection is the result type's spread —
    // its field body lives in the type's own @mapping. Wrapper structure (a `data { … }`
    // response object, array nesting) is preserved: the wrapper type spreads here and carries
    // the inner structure in its mapping. Scalar/JSON/union/map roots fall back to inline.
    if (context.generateOptions.reusableMappings) {
      const root = type instanceof Res ? type.response : type;
      const spread = T.mappingSpreadName(root, selection);
      if (spread) {
        writer.write(' '.repeat(6)).write(`...${spread}\n`);
        return;
      }
    }

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
