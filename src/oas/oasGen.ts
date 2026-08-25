import Oas from 'oas';
import OASNormalize from 'oas-normalize';
import { GraphQLError, parse } from 'graphql';
import { Operation, Webhook } from 'oas/operation';
import { HttpMethods, OASDocument } from 'oas/types';
import { OpenAPI } from 'openapi-types';

import fs from 'fs';
import { DEFAULT_VERSIONS, validateVersionOptions } from '../versions.js';
import { BatchConfig, GenerateOptions, OasContext, OverridesConfig } from './oasContext.js';
import { Factory, Get, IType, T } from './nodes/internal.js';
import { Writer } from './io/writer.js';
import { trace } from './log/trace.js';
import { TypesCollector } from './generator/typesCollector.js';
import { Mapper } from './mapper/types.js';
import { Naming } from './utils/naming.js';
import { Directives, DirectivesConfig } from './lint/directives.js';
import { Namespace } from './lint/namespace.js';
import { SYN_SUCCESS_RESPONSE } from './schemas/index.js';

// A response as it looks in the raw file, before anything has checked it makes sense -- only the
// two things repairMalformedResponses cares about: does it have a body, and for each body, does
// it have a schema.
interface RawResponse {
  content?: Record<string, { schema?: unknown } | undefined>;
}

// An operation (the "get", "post", etc. block under one path) as it looks in the raw file.
interface RawOperation {
  responses?: Record<string, RawResponse>;
}

// every HTTP verb OpenAPI lets a path item declare -- validation checks the whole file, so a
// malformed response under any of these, not just the ones `gen` reads, would still crash it
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

// A `schema: null` or an empty `responses: {}` both fail OpenAPI's own checker before `gen` gets
// a turn, crashing the whole file over one bad response. Runs before that checker, turning both
// into shapes `gen` already reads on its own: no `content` key, or a placeholder success reply.
//   e.g. (World Anvil) content: { application/json: { schema: null } } -> that entry is dropped
//   (and `content` itself too, if it was the only body type) -- see docs/FIXED.md #147.
function checkAndFixMalformedResponses(doc: Record<string, unknown>): void {
  const paths = doc.paths as Record<string, Record<string, RawOperation>> | undefined;
  if (!paths) return;

  for (const pathItem of Object.values(paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation || !operation.responses) continue;

      const responses = operation.responses;
      if (Object.keys(responses).length === 0) {
        responses['200'] = SYN_SUCCESS_RESPONSE;
        continue;
      }

      for (const response of Object.values(responses)) {
        const content = response?.content;
        if (!content) continue;

        // a real spec (Confluence) already has responses whose `content` was written as `{}` on
        // purpose, unrelated to #148 -- only drop `content` when a null-schema entry emptied it,
        // not when it started empty.
        let droppedEntry = false;
        for (const [mediaType, media] of Object.entries(content)) {
          if (media && media.schema === null) {
            delete content[mediaType];
            droppedEntry = true;
          }
        }
        if (droppedEntry && Object.keys(content).length === 0) {
          delete response.content;
        }
      }
    }
  }
}

interface IGenOptions {
  skipValidation?: boolean;
  baseURL?: string;
  overrides?: OverridesConfig;
  batch?: BatchConfig;
  sparseFieldsetsParam?: string;
  showParentInSelections: boolean;
  federationVersion?: string;
  connectorSpecVersion?: string;
  mapper?: Mapper;
  skipOptionalArgs?: boolean;
  skipOptionalMarkers?: boolean;
  skipArgDefaults?: boolean;
  keepFieldNames?: boolean;
  docResponseFields?: boolean;
  servicePrefix?: string;
  inferEntityResolvers?: boolean;
  emitConnectorErrors?: boolean;
  skipAuth?: boolean;
  authValuePrefix?: string;
  directives?: DirectivesConfig;
}

export class OasGen {
  public selections: string[] = [];
  private visited: boolean = false;

  public static async fromData(
    data: ArrayBuffer,
    options: IGenOptions = {
      skipValidation: false,
      showParentInSelections: false,
      federationVersion: DEFAULT_VERSIONS.federationVersion,
      connectorSpecVersion: DEFAULT_VERSIONS.connectorSpecVersion,
      mapper: undefined,
      skipOptionalArgs: false,
      skipOptionalMarkers: false,
    },
  ): Promise<OasGen> {
    validateVersionOptions(options);

    const normalizer: OASNormalize = new OASNormalize(data, {
      enablePaths: true,
    });

    const _loaded: Record<string, unknown> = await normalizer.load();
    checkAndFixMalformedResponses(_loaded);
    console.log('loaded file');

    const _normalised: OpenAPI.Document = await normalizer.bundle();
    console.log('loaded bundle');

    if (!options.skipValidation) {
      const validated: boolean = await normalizer.validate();
      if (!validated) {
        console.log('validated', validated);
        throw new Error('Could not validate source file');
      }
    }

    const json = await normalizer.convert();
    console.log('converted');

    const parser: Oas = new Oas(json as OASDocument);
    return new OasGen(parser, options);
  }

  public static async fromFile(
    sourceFile: string,
    options: IGenOptions = {
      skipValidation: false,
      showParentInSelections: false,
      federationVersion: DEFAULT_VERSIONS.federationVersion,
      connectorSpecVersion: DEFAULT_VERSIONS.connectorSpecVersion,
      mapper: undefined,
      skipOptionalArgs: false,
      skipOptionalMarkers: false,
    },
    // prompt: Prompt
  ): Promise<OasGen> {
    validateVersionOptions(options);

    if (!fs.existsSync(sourceFile)) {
      throw new Error('Source not found: ' + sourceFile);
    }

    const normalizer: OASNormalize = new OASNormalize(sourceFile, {
      enablePaths: true,
    });

    const _loaded: Record<string, unknown> = await normalizer.load();
    checkAndFixMalformedResponses(_loaded);
    console.log('loaded file');

    const _normalised: OpenAPI.Document = await normalizer.bundle();
    console.log('loaded bundle');

    if (!options.skipValidation) {
      const validated: boolean = await normalizer.validate();
      if (!validated) {
        console.log('validated', validated);
        throw new Error('Could not validate source file');
      }
    }

    const json = await normalizer.convert();
    console.log('converted');

    const parser: Oas = new Oas(json as OASDocument);
    return new OasGen(parser, options);
  }

  public parser: Oas;
  // public prompt: Prompt;
  public context?: OasContext;
  public paths: Map<string, IType> = new Map();
  public options: GenerateOptions;
  private collector: TypesCollector;

  constructor(parser: Oas, options: GenerateOptions) {
    this.parser = parser;
    this.options = options;
    this.collector = new TypesCollector(this);
  }

  public title(): string {
    return this.parser.getDefinition().info.title;
  }

  public version(): string {
    return this.parser.getDefinition().info.version;
  }

  public expanded(paths: string[]): string[] {
    return this.isolatedRun(() => {
      this.collector.collect(paths);
      return this.collector.expanded;
    });
  }

  public getTypes(paths: string[]): Map<string, IType> {
    return this.isolatedRun(() => {
      this.collector.collect(paths);
      return this.collector.types;
    });
  }

  public generateSchema(paths: string[]): string {
    return this.isolatedRun(() => {
      // typo guard: an override key that matches no operation would silently do nothing. A root
      // value other than "query"/"mutation" (e.g. "Mutation", capitalized) is caught here too.
      for (const [key, entry] of Object.entries(this.options.overrides ?? {})) {
        if (!this.paths.has(key)) {
          console.warn(`[overrides] no operation matches "${key}" — override ignored.`);
        } else if (entry?.root !== undefined && entry.root !== 'query' && entry.root !== 'mutation') {
          throw new Error(
            `[overrides] "${key}".root must be "query" or "mutation", got ${JSON.stringify(entry.root)}.`,
          );
        }
      }

      this.collector.collect(paths);

      const writer: Writer = new Writer(this);
      writer.generateWith(this.collector.types, this.collector.expanded);

      // Hand back what the caller asked for, not what we expanded it into -- "everything under
      // this op" stays one entry instead of one per field. e.g. ['get:/lists/{id}>**'] in, same
      // one entry out, not the 38,300 field paths that op's schema has. #118, #139
      this.selections = paths;

      const schema = writer.flush();
      // The generator's own output must be valid GraphQL before anything downstream (Directives,
      // Namespace) tries to parse it — both do so unconditionally, and an uncaught GraphQLError
      // there crashes the whole process instead of naming the real problem. #111
      try {
        parse(schema);
      } catch (e) {
        throw new Error(`[gen] generated an invalid GraphQL schema: ${OasGen.describeParseError(e)}`);
      }
      // R14: directives the user declared go in after generation, over the finished document
      const directed = this.options.directives ? Directives.apply(schema, this.options.directives) : schema;
      // last, so `--directives` selectors keep naming the types as the generator wrote them
      const final = this.options.servicePrefix ? Namespace.apply(directed, this.options.servicePrefix) : directed;

      // The gate above only covers the generator's own output — a user-supplied directive string is
      // spliced in only checked for a leading "@", never parsed, and can still break valid SDL. #111
      //   e.g. { "Widget": ["@tag(name: \"unterminated"] } -> `type Widget @tag(name: "unterminated {`
      if (this.options.directives || this.options.servicePrefix) {
        try {
          parse(final);
        } catch (e) {
          throw new Error(
            `[gen] --directives or --service-prefix produced invalid GraphQL: ${OasGen.describeParseError(e)}`,
          );
        }
      }
      return final;
    });
  }

  // GraphQLError carries line/column in `.locations`, not in `.message` — add it so a thrown parse
  // failure names where in the (often thousand-line) schema the problem is, not just what it is.
  //   e.g. "Syntax Error: Unterminated string." -> "Syntax Error: Unterminated string. (at 5:39)"
  private static describeParseError(e: unknown): string {
    const message = (e as Error).message;
    if (!(e instanceof GraphQLError) || !e.locations?.length) {
      return message;
    }
    const at = e.locations.map((l) => `${l.line}:${l.column}`).join(', ');
    return `${message} (at ${at})`;
  }

  // Runs a generation on a fresh context and fresh path nodes, then puts back the ones the web's
  // tree is holding — names stored by earlier calls made free names look taken.
  // e.g. (digitalocean.yaml) ActiveDeployment came out as Inlinev2AppsDeploymentsResponseActiveDeployment. #71
  private isolatedRun<T>(fn: () => T): T {
    const treeContext = this.context;
    const treePaths = this.paths;
    try {
      this.context = new OasContext(this.parser, this.options);
      this.paths = this.buildPaths();
      return fn();
    } finally {
      this.context = treeContext;
      this.paths = treePaths;
    }
  }

  public async visit(): Promise<void> {
    this.paths = this.buildPaths();
  }

  public visitSync(): void {
    if (this.visited) return;
    this.paths = this.buildPaths();
  }

  // One op node per supported path — its fields and types are built later, when a selection walks in.
  private buildPaths(): Map<string, IType> {
    const context = this.getContext();

    const paths = this.parser.getPaths();
    const filtered = Object.entries(paths)
      .filter(([_key, pathItem]) => this.isSupported(pathItem))
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));

    const collected = new Map<string, IType>();
    for (const [key, pathItem] of filtered) {
      this.visitPath(context, key, pathItem).forEach((type) => collected.set(type.id, type));
    }

    // two paths can clean to one root field — the later op takes a numbered name.
    // e.g. (cleaned-path-collision.yaml) /foo-bar + /foo.bar -> fooBar, fooBar2. see docs/FIXED.md #116
    const queryFieldNames = new Set<string>();
    const mutationFieldNames = new Set<string>();
    for (const type of collected.values()) {
      const takenNames = T.isMutationType(type, context) ? mutationFieldNames : queryFieldNames;
      const op = type as Get;
      const name = op.getGqlOpName();
      if (takenNames.has(name)) {
        op.renamedTo = Naming.numberedName(name, (n) => takenNames.has(n));
      }
      takenNames.add(op.getGqlOpName());
    }

    return collected;
  }

  private isSupported(pathItem: Record<HttpMethods, Webhook | Operation>) {
    return pathItem.get || pathItem.post || pathItem.put || pathItem.delete || pathItem.patch;
  }

  public getContext(): OasContext {
    if (!this.context) {
      this.context = new OasContext(this.parser, this.options);
    }
    return this.context;
  }

  public expand(type: IType): IType[] {
    const ctx = this.getContext();
    const path = type.path();

    trace(ctx, '-> [expand]', `in: path: ${path}`);
    type.visit(ctx);
    trace(ctx, '<- [expand]', `out: path: ${path}`);

    return type.children;
  }

  public find(path: string): IType | boolean {
    for (const [_name, type] of this.paths) {
      if (type.path() === path) {
        return type;
      }

      type.visit(this.getContext());

      const result = type.find(path, type.children);
      if (result) {
        return result;
      }
    }

    return false;
  }

  /** this seems a bit buggy at the moment, needs more testing **/
  public findPath(path: string): IType | boolean {
    let collection = Array.from(this.paths.values());
    let current: IType | undefined;
    let last: IType | undefined;

    let i = 0;
    const parts = path.split(Naming.PATH_SEPARATOR);
    do {
      const part = Naming.expandRef(parts[i]);
      current = collection.find((t) => t.id === part);
      if (!current) {
        throw new Error('Could not find type: ' + part + ' from ' + path + ', last: ' + last?.pathToRoot());
      }

      // make sure we expand it before we move on to the next part
      this.expand(current);
      last = current;

      collection = Array.from(current!.children.values()) || Array.from(current!.props.values()) || [];

      i++;
    } while (i < parts.length);

    return current;
  }

  public writer(): Writer {
    return new Writer(this);
  }

  // private methods
  private visitGet(context: OasContext, name: string, op: Operation): IType {
    trace(context, '-> [visitGet]', `in:  [${name}] id: ${op.getOperationId()}`);
    const result = Factory.createGet(name, op);
    trace(context, '<- [visitGet]', `out: [${name}] id: ${op.getOperationId()}`);
    return result;
  }

  private visitPost(context: OasContext, name: string, op: Operation): IType {
    trace(context, '-> [visitPost]', `in:  [${name}] id: ${op.getOperationId()}`);
    const result = Factory.fromPost(name, op);
    trace(context, '<- [visitPost]', `out: [${name}] id: ${op.getOperationId()}`);
    return result;
  }

  private visitPut(context: OasContext, name: string, op: Operation): IType {
    trace(context, '-> [visitPut]', `in:  [${name}] id: ${op.getOperationId()}`);
    const result = Factory.fromPut(name, op);
    trace(context, '<- [visitPut]', `out: [${name}] id: ${op.getOperationId()}`);
    return result;
  }

  private visitPatch(context: OasContext, name: string, op: Operation): IType {
    trace(context, '-> [visitPatch]', `in:  [${name}] id: ${op.getOperationId()}`);
    const result = Factory.fromPatch(name, op);
    trace(context, '<- [visitPatch]', `out: [${name}] id: ${op.getOperationId()}`);
    return result;
  }

  private visitDelete(context: OasContext, name: string, op: Operation): IType {
    trace(context, '-> [visitDelete]', `in:  [${name}] id: ${op.getOperationId()}`);
    const result = Factory.fromDelete(name, op);
    trace(context, '<- [visitDelete]', `out: [${name}] id: ${op.getOperationId()}`);
    return result;
  }

  private visitPath(context: OasContext, name: string, pathItem: Record<string, Webhook | Operation>): IType[] {
    const paths: IType[] = [];
    if (pathItem.get !== undefined) {
      paths.push(this.visitGet(context, name, pathItem.get as Webhook | Operation));
    }

    if (pathItem.post !== undefined) {
      paths.push(this.visitPost(context, name, pathItem.post));
    }

    if (pathItem.put !== undefined) {
      paths.push(this.visitPut(context, name, pathItem.put));
    }

    if (pathItem.patch !== undefined) {
      paths.push(this.visitPatch(context, name, pathItem.patch));
    }

    if (pathItem.delete !== undefined) {
      paths.push(this.visitDelete(context, name, pathItem.delete));
    }

    return paths;
  }
}
