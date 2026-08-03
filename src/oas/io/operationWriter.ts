import _ from 'lodash';
import { ParameterObject } from 'oas/types';
import { OasContext, RequestOverride } from '../oasContext.js';
import { OasGen } from '../oasGen.js';
import { Body, IType, Op, Param, Res, T, Type } from '../nodes/internal.js';
import { Naming } from '../utils/naming.js';
import { Params } from '../utils/params.js';
import { ErrorsWriter } from './errorsWriter.js';
import { Writer } from './writer.js';
import { NameValue, SecurityPlan } from './security.js';

export class OperationWriter {
  private errorsWriter: ErrorsWriter;

  constructor(
    private gen: OasGen,
    private security: SecurityPlan,
  ) {
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

    // R5: this op's resolved auth, split by placement. A header lives on @connect only in per-op
    // mode (uniform mode puts it on @source); query auth always lives here (@source has no
    // queryParams). Warnings are owned by the plan — see security.ts.
    const { header: headerAuth, query: queryAuth } = this.security.forOp(op);

    const path = this.templatedPath(op, override);

    // body is emitted last; its presence is cheap to compute up front. the body block streams
    // through the node tree (Body.select), so unlike query/headers it writes to `writer` directly
    // instead of returning a string. `null` drops the body; a string overrides it; see ROADMAP R9.
    const hasBody = typeof override?.body === 'string' || (override?.body === undefined && !!op.body);

    // query & header blocks are pure string-building — they return the block, or null when empty
    const queryBlock = this.queryParamsBlock(context, op, override, queryAuth);
    const headerBlock = this.headersBlock(op, override, headerAuth);

    if (!queryBlock && !headerBlock && !hasBody) {
      // nothing but the path: keep the compact single-line form `{ GET: "/x"}`
      writer.write(`{ ${op.verb}: "${path}"}`);
      return;
    }

    // expanded: `http: {` on its own line, the verb and each member at indent 8, the closing `}`
    // aligned under `http:` (indent 6). members are comma-less (GraphQL multiline object style).
    writer.write('{\n');
    writer.write(' '.repeat(8) + `${op.verb}: "${path}"\n`);
    if (queryBlock) writer.write(queryBlock);
    if (headerBlock) writer.write(headerBlock);
    if (hasBody) {
      if (typeof override?.body === 'string') {
        this.writeBodyOverride(writer, override.body);
      } else if (op.body) {
        this.writeBodySelection(context, writer, op.body, selection);
      }
    }
    writer.write(' '.repeat(6) + '}');
  }

  // template each {elem} as {$args.<sanitised>} (the arg name), not the raw OAS key. see docs/issues.md #2
  // an override path may already template (`{$args.id}`, `{$config.v}`) — leave `$` segments alone
  private templatedPath(op: Op, override?: RequestOverride): string {
    return (override?.path ?? op.operation.path).replace(/\{([^}]+)\}/g, (m, name) =>
      name.startsWith('$') ? m : `{$args.${Naming.genParamName(name)}}`,
    );
  }

  // the op's queryParams block (a self-contained string ending in a newline), or null when the op
  // has no query params and no apiKey-in-query auth. `auth` is the op's resolved apiKey-in-query
  // entry (or null) — see requestMethod / security.forOp.
  private queryParamsBlock(
    context: OasContext,
    op: Op,
    override: RequestOverride | undefined,
    auth: NameValue | null,
  ): string | null {
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

    // R5 slice 3: apiKey-in-query auth merges into the same query-param object as a JSONSelection
    // sibling outside the `$args { … }` block, so an auth-only op still emits a queryParams block.
    if (entries.length === 0 && !auth) {
      return null;
    }

    const lines: string[] = ['        queryParams: """'];
    // the `$args { … }` block only when there are arg-derived params (skipped for auth-only ops)
    if (entries.length > 0) {
      lines.push('          $args {');
      for (const { name, value } of entries) {
        lines.push(`            "${name}": ${value}`);
      }
      lines.push('          }');
    }
    // e.g. `"api_key": $config.apiKey` — key quoted so non-identifier names like `api-key` are safe
    if (auth) {
      lines.push(`          "${auth.name}": ${auth.value}`);
    }
    lines.push('        """');
    return lines.join('\n') + '\n';
  }

  // the op's headers block (a self-contained string ending in a newline), or null when there are
  // no headers to send. `auth` is the op's resolved auth header (or null) — see requestMethod.
  private headersBlock(op: Op, override: RequestOverride | undefined, auth: NameValue | null): string | null {
    // OAS `header` params, with user overrides merged in (string replaces, null drops)
    const headers = op.operation.getParameters().filter((p) => p.in && p.in.toLowerCase() === 'header');
    let entries = this.mergeOverrides(headers, override?.headers ?? {}, (p) => this.headerExample(p));

    // HTTP header names are case-insensitive: an explicit user override of the same name wins;
    // otherwise the resolved auth replaces any inferred OAS header of that name (so we never emit
    // a real credential alongside a placeholder that differs only in case).
    if (auth) {
      const sameName = (name: string) => name.toLowerCase() === auth.name.toLowerCase();
      const overridden = Object.keys(override?.headers ?? {}).some(sameName);
      if (!overridden) {
        entries = [auth, ...entries.filter((entry) => !sameName(entry.name))];
      }
    }

    if (entries.length === 0) {
      return null;
    }

    const lines: string[] = ['        headers: ['];
    for (const { name, value } of entries) {
      lines.push(`          { name: "${name}", value: "${value}" }`);
    }
    lines.push('        ]');
    return lines.join('\n') + '\n';
  }

  // merge user overrides over the inferred params: a string replaces the inferred value,
  // null drops the entry, an unknown key is appended. see ROADMAP R8
  private mergeOverrides<T extends { name: string }>(
    inferred: T[],
    overrides: Record<string, string | null>,
    inferredValue: (item: T) => string,
  ): NameValue[] {
    const kept = inferred
      .filter((item) => overrides[item.name] !== null)
      .map((item): NameValue => ({ name: item.name, value: overrides[item.name] ?? inferredValue(item) }));

    // overrides whose key isn't an inferred param are appended (null already excluded above)
    const known = new Set(inferred.map((item) => item.name));
    const appended: NameValue[] = [];
    for (const [name, value] of Object.entries(overrides)) {
      if (!known.has(name) && value != null) {
        appended.push({ name, value });
      }
    }

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

  // mirrors Body.select formatting, but the user's raw JSONSelection replaces the whole mapping.
  // emits the block at indent 8 (an http-object member), ending with a newline; the caller places
  // the http object's closing brace.
  private writeBodyOverride(writer: Writer, body: string): void {
    const spacing = ' '.repeat(8);
    writer.write(spacing + 'body: """\n');
    for (const line of body.split('\n')) {
      writer.write(spacing + '  ' + line + '\n');
    }
    writer.write(spacing + '"""\n');
  }

  private writeSelection(context: OasContext, writer: Writer, type: IType, selection: string[]): void {
    context.indent = 6;

    // R10: in reusable-mappings mode the @connect selection invokes the result type's @mapping —
    // its field body lives in the type's own @mapping. Wrapper structure (a `data { … }`
    // response object, array nesting) is preserved: the wrapper type is invoked here and carries
    // the inner structure in its mapping. Scalar/JSON/union/map roots fall back to inline.
    //
    // `$` is the whole response body at this position (nothing has entered a `{ … }` block yet,
    // so `$` and `@` coincide); `$` matches the documented idiom for a connector root.
    if (context.generateOptions.reusableMappings) {
      const root = type instanceof Res ? type.response : type;
      const spread = T.mappingSpreadName(root, selection);
      if (spread) {
        writer.write(' '.repeat(6)).write(`$->${spread}\n`);
        return;
      }
    }

    type.select(context, writer, selection);
  }

  private writeBodySelection(context: OasContext, writer: Writer, body: Body, selection: string[]): void {
    context.indent = 8;
    body.select(context, writer, selection);
  }
}
