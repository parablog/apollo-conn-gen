import _ from 'lodash';
import { ParameterObject } from 'oas/types';
import { OasContext, RequestOverride } from '../oasContext.js';
import { OasGen } from '../oasGen.js';
import { Body, IType, Op, Param, T } from '../nodes/internal.js';
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
    if (!T.isOp(type)) {
      throw new Error(`expected an operation node, got ${type.id}`);
    }

    const op = type;
    const indent = 0;
    let spacing = ' '.repeat(indent + 4);
    writer.write(spacing).write('@connect(\n');

    spacing = ' '.repeat(indent + 6);
    writer.write(spacing).write('source: "api"\n').write(spacing).write('http: ');

    this.requestMethod(context, writer, op, selection, indent);

    writer.write('\n').write(spacing).write('selection: """\n');

    // truthiness, not _.has — the declared-but-unset field is still an own property. #33
    if (op.resultType) {
      this.writeSelection(context, writer, op.resultType, selection);
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

  private requestMethod(context: OasContext, writer: Writer, op: Op, selection: string[], _indent: number): void {
    const override = context.generateOptions.overrides?.[op.id];

    // write HTTP stuff first, then headers, query params and lastly headers
    writer.write(`{ ${op.verb}: `).write('"' + this.templatedPath(op, override) + '"');
    this.writeQueryParams(context, writer, op, override);
    this.writeHeaders(writer, op, override);

    // only fo PUT, POST, etc.
    if (_.has(op, 'body')) {
      this.writeBodySelection(context, writer, op.body as Body, selection);
    }

    writer.write('}');
  }

  // template each {elem} as {$args.<sanitised>} (the arg name), not the raw OAS key. see docs/issues.md #2
  // an override path may already template (`{$args.id}`, `{$config.v}`) — leave `$` segments alone
  private templatedPath(op: Op, override?: RequestOverride): string {
    return (override?.path ?? op.operation.path).replace(/\{([^}]+)\}/g, (m, name) =>
      name.startsWith('$') ? m : `{$args.${Naming.genParamName(name)}}`,
    );
  }

  private writeQueryParams(context: OasContext, writer: Writer, op: Op, override?: RequestOverride): void {
    // we now include all query params, not just required ones. if they are not set,
    // then the connectors will not include them in the request.
    let queryParams = op.params.filter((p: Param) => {
      return p.parameter.in && p.parameter.in.toLowerCase() === 'query';
    });

    // Skip optional params if skipOptionalArgs is true
    if (context.generateOptions?.skipOptionalArgs) {
      queryParams = queryParams.filter((p: Param) => p.required);
    }

    // e.g. `"api-version": $('2024-01')` appended, `"ids": ids->joinNotNull(";")` replaced
    const entries = this.mergeOverrides(
      queryParams,
      override?.queryParams ?? {},
      (p) => `${Naming.genParamName(p.name)}${this.arrayJoin(p)}`,
    );
    if (entries.length === 0) {
      return;
    }

    writer.write('\n');
    let spacing = ' '.repeat(6);

    writer.write(spacing).write(`queryParams: """\n`);
    spacing = ' '.repeat(8);
    writer.write(spacing).write(`$args {\n`);
    spacing = ' '.repeat(10);
    for (const [key, value] of entries) {
      writer.write(spacing).write(`"${key}": ${value}\n`);
    }
    spacing = ' '.repeat(8);
    writer.write(spacing).write('}\n');
    spacing = ' '.repeat(6);
    writer.write(spacing).write('"""\n');
  }

  private writeHeaders(writer: Writer, op: Op, override?: RequestOverride): void {
    const headers = op.operation.getParameters().filter((p) => p.in && p.in.toLowerCase() === 'header');
    const entries = this.mergeOverrides(headers, override?.headers ?? {}, (p) => this.headerExample(p));
    if (entries.length === 0) {
      return;
    }

    let spacing = ' '.repeat(6);
    writer.write(spacing + 'headers: [\n');
    spacing = ' '.repeat(8);

    for (const [key, value] of entries) {
      writer.write(spacing + `{ name: "${key}", value: "${value}" }\n`);
    }

    spacing = ' '.repeat(6);
    writer.write(spacing + ']');
  }

  // merge user overrides over the inferred params: a string replaces the inferred value,
  // null drops the entry, an unknown key is appended. see ROADMAP R8
  private mergeOverrides<T extends { name: string }>(
    inferred: T[],
    overrides: Record<string, string | null>,
    inferredValue: (item: T) => string,
  ): Array<[string, string]> {
    const kept = inferred
      .filter((item) => overrides[item.name] !== null)
      .map((item): [string, string] => [item.name, overrides[item.name] ?? inferredValue(item)]);

    const known = new Set(inferred.map((item) => item.name));
    const appended = Object.entries(overrides).filter(
      (entry): entry is [string, string] => !known.has(entry[0]) && entry[1] != null,
    );

    return [...kept, ...appended];
  }

  // inferred header value: the example, the example keys, or a placeholder for the user to fill
  private headerExample(p: ParameterObject): string {
    if (p.example != null) {
      return p.example.toString();
    }
    if (p.examples && Object.keys(p.examples).length > 0) {
      return Object.keys(p.examples).join(',');
    }
    return '<placeholder>';
  }

  // a non-exploded array param (`?ids=1,2,3`) needs its values joined: `ids->joinNotNull(",")`. see ROADMAP R8
  // exploded arrays (the OAS default) already work as a plain array value
  private arrayJoin(p: Param): string {
    const parameter = p.parameter;
    if (_.get(parameter, 'schema.type') !== 'array' || parameter.explode !== false) {
      return '';
    }
    const delimiter = parameter.style === 'spaceDelimited' ? ' ' : parameter.style === 'pipeDelimited' ? '|' : ',';
    return `->joinNotNull("${delimiter}")`;
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
