import _ from 'lodash';
import { ParameterObject } from 'oas/types';
import { OasContext, RequestOverride } from '../oasContext.js';
import { OasGen } from '../oasGen.js';
import { Body, IType, Op, Param, T } from '../nodes/internal.js';
import { Naming } from '../utils/naming.js';
import { Params } from '../utils/params.js';
import { ErrorsWriter } from './errorsWriter.js';
import { Writer } from './writer.js';
import { anyOperationDeclaresSecurity, globalSecurity, securitySchemes, resolveAuthHeader } from './security.js';

export class OperationWriter {
  private errorsWriter: ErrorsWriter;

  constructor(private gen: OasGen) {
    this.errorsWriter = new ErrorsWriter(gen);
  }

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

    this.errorsWriter.write(context, writer, op, indent);

    spacing = ' '.repeat(indent + 4);
    writer.write(spacing).write(')\n');
  }

  private requestMethod(context: OasContext, writer: Writer, op: Op, selection: string[], _indent: number): void {
    const override = context.generateOptions.overrides?.[op.id];

    // the verb + path first, then query params, headers and lastly the body
    writer.write(`{ ${op.verb}: `).write('"' + this.templatedPath(op, override) + '"');
    // each block starts on its own line and ends without a trailing newline
    const wroteQueryParams = this.writeQueryParams(context, writer, op, override);
    const wroteHeaders = this.writeHeaders(writer, op, override);

    // body (POST, PUT, etc.): an override (raw JSONSelection) replaces the inferred
    // `$args.input { … }` mapping; null drops the body altogether. see ROADMAP R9
    if (typeof override?.body === 'string') {
      // body emits its own trailing indent, so close the object right after it
      this.writeBodyOverride(writer, override.body);
      writer.write('}');
    } else if (override?.body === undefined && op.body) {
      // body emits its own trailing indent, so close the object right after it
      this.writeBodySelection(context, writer, op.body, selection);
      writer.write('}');
    } else if (wroteQueryParams || wroteHeaders) {
      // no body: close on its own line, aligned under `http:` (avoids a column-0 brace)
      writer.write('\n' + ' '.repeat(6) + '}');
    } else {
      // nothing but the path: keep the compact single-line form `{ GET: "/x"}`
      writer.write('}');
    }
  }

  // template each {elem} as {$args.<sanitised>} (the arg name), not the raw OAS key. see docs/issues.md #2
  // an override path may already template (`{$args.id}`, `{$config.v}`) — leave `$` segments alone
  private templatedPath(op: Op, override?: RequestOverride): string {
    return (override?.path ?? op.operation.path).replace(/\{([^}]+)\}/g, (m, name) =>
      name.startsWith('$') ? m : `{$args.${Naming.genParamName(name)}}`,
    );
  }

  // returns true when a queryParams block was written (so the caller can place the closing brace)
  private writeQueryParams(context: OasContext, writer: Writer, op: Op, override?: RequestOverride): boolean {
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
      return false;
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
    // no trailing newline — the caller adds the separator/brace
    writer.write(spacing).write('"""');
    return true;
  }

  // returns true when a headers block was written (so the caller can place the closing brace)
  private writeHeaders(writer: Writer, op: Op, override?: RequestOverride): boolean {
    // OAS `header` params, with user overrides merged in (string replaces, null drops)
    const headers = op.operation.getParameters().filter((p) => p.in && p.in.toLowerCase() === 'header');
    let entries = this.mergeOverrides(headers, override?.headers ?? {}, (p) => this.headerExample(p));

    // R5 slice 2: add this operation's effective auth header (only when the spec is in per-op mode).
    // HTTP header names are case-insensitive: an explicit user override of the same name wins;
    // otherwise the resolved auth replaces any inferred OAS header of that name (so we never emit
    // a real credential alongside a placeholder that differs only in case).
    const auth = this.authHeaderEntry(op);
    if (auth) {
      const sameName = (name: string) => name.toLowerCase() === auth[0].toLowerCase();
      const overridden = Object.keys(override?.headers ?? {}).some(sameName);
      if (!overridden) {
        entries = [auth, ...entries.filter(([name]) => !sameName(name))];
      }
    }

    if (entries.length === 0) {
      return false;
    }

    let spacing = ' '.repeat(6);
    // leading newline so the block starts on its own line (after the path or a queryParams block)
    writer.write('\n' + spacing + 'headers: [\n');
    spacing = ' '.repeat(8);

    for (const [key, value] of entries) {
      writer.write(spacing + `{ name: "${key}", value: "${value}" }\n`);
    }

    spacing = ' '.repeat(6);
    // no trailing newline — the caller adds the separator/brace
    writer.write(spacing + ']');
    return true;
  }

  // R5 slice 2: this operation's effective auth header as a [name, value] entry, or null.
  //
  // Emits only in *per-op mode* — when some operation in the spec declares its own `security`,
  // the shared @source auth header is suppressed, so each @connect must carry its own. The
  // effective requirement is the op's own `security` when present, else the global default:
  //   security: [{ AdminBearer: [] }]  (own)     -> that scheme's header (e.g. Authorization: Bearer)
  //   security: []                     (public)  -> no header (the op correctly sends nothing)
  //   no own `security`                           -> the inherited global header
  private authHeaderEntry(op: Op): [string, string] | null {
    const api = this.gen.parser;
    // uniform mode: @source already carries the shared auth, nothing to add per operation
    if (!anyOperationDeclaresSecurity(api)) {
      return null;
    }

    // the op's own requirement; `undefined` = inherit the global, `[]` = public
    const own = op.operation.schema.security;
    // `??` not `||`: an explicit `[]` (public) must NOT fall back to the global
    const effective = own ?? globalSecurity(api);

    // read the scheme definitions the requirement refers to
    const schemes = securitySchemes(api);
    // resolve the effective requirement to one header, collecting per-scheme drop warnings
    const { header, warnings } = resolveAuthHeader(effective, schemes);
    // surface dropped schemes loudly, tagged with this operation
    for (const w of warnings) {
      console.warn(`${w} (operation ${op.verb} ${op.operation.path})`);
    }
    return header ? [header.name, header.value] : null;
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

  // see Params.arrayJoin (shared with the R6 batch path)
  private arrayJoin(p: Param): string {
    return Params.arrayJoin(p.parameter);
  }

  private writeSelection(context: OasContext, writer: Writer, type: IType, selection: string[]): void {
    context.indent = 6;
    type.select(context, writer, selection);
  }

  // mirrors Body.select formatting, but the user's raw JSONSelection replaces the whole mapping
  private writeBodyOverride(writer: Writer, body: string): void {
    writer.write(',\n');
    const spacing = ' '.repeat(6);
    writer.write(spacing + 'body: """\n');
    for (const line of body.split('\n')) {
      writer.write(spacing + '  ' + line + '\n');
    }
    writer.write(spacing + '"""\n' + ' '.repeat(5));
  }

  private writeBodySelection(context: OasContext, writer: Writer, body: Body, selection: string[]): void {
    writer.write(',\n');
    context.indent = 6;
    if (body) {
      body.select(context, writer, selection);
    }
  }
}
