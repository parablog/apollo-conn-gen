import Oas from 'oas';
import OASNormalize from 'oas-normalize';
import { Operation, Webhook } from 'oas/operation';
import { OASDocument } from 'oas/types';
import { OpenAPI } from 'openapi-types';

import fs from 'fs';
import { OasContext } from './oasContext.js';
import { Factory } from './nodes/internal.js';
import { Writer } from './io/writer.js';
import { trace } from './log/trace.js';
import { IType } from './nodes/internal.js';

interface IGenOptions {
  skipValidation: boolean;
}

export class OasGen {
  public static async fromData(
    data: ArrayBuffer,
    options: IGenOptions = {
      skipValidation: false,
    },
  ): Promise<OasGen> {
    const normalizer: OASNormalize = new OASNormalize(data, {
      enablePaths: true,
    });

    const _loaded: Record<string, unknown> = await normalizer.load();
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
    // return new ConnectorGen(oas, prompt);
    return new OasGen(parser);
  }

  public static async fromFile(
    sourceFile: string,
    options: IGenOptions = {
      skipValidation: false,
    },
    // prompt: Prompt
  ): Promise<OasGen> {
    if (!fs.existsSync(sourceFile)) {
      throw new Error('Source not found: ' + sourceFile);
    }

    // const options = { resolve: true, resolveCombinators: false };
    // const oas = new OpenAPIV3Parser().read(source, null, options);
    const normalizer: OASNormalize = new OASNormalize(sourceFile, {
      enablePaths: true,
    });

    const _loaded: Record<string, unknown> = await normalizer.load();
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
    // return new ConnectorGen(oas, prompt);
    return new OasGen(parser);
  }

  public parser: Oas;
  // public prompt: Prompt;
  public context?: OasContext;
  public paths: Map<string, IType> = new Map();

  constructor(parser: Oas) {
    this.parser = parser;
    // this.prompt = prompt;
  }

  public title(): string {
    return this.parser.getDefinition().info.title;
  }

  public version(): string {
    return this.parser.getDefinition().info.version;
  }

  public generateSchema(paths: string[]): string {
    const writer: Writer = new Writer(this);
    writer.generate(paths);
    return writer.flush();
  }

  public async visit(): Promise<void> {
    const parser = this.parser;
    const context = this.getContext();

    const paths = parser.getPaths();
    const filtered = Object.entries(paths)
      .filter(([_key, pathItem]) => pathItem.get !== undefined)
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));

    const collected = new Map<string, IType>();
    for (const [key, pathItem] of filtered) {
      const result = this.visitPath(context, key, pathItem);
      collected.set(key, result);
    }

    this.paths = collected;
  }

  public getContext(): OasContext {
    if (!this.context) {
      this.context = new OasContext(this.parser);
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

  public findPath(path: string): IType | boolean {
    let collection = Array.from(this.paths.values());
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

  private visitGet(_context: OasContext, name: string, op: Operation): IType {
    // TODO
    // operation.visit(context);
    return Factory.createGet(name, op);
  }

  private printRefs(values: Map<string, number>): void {
    console.log('----------- ref count -------------- ');
    values.forEach((value, key) => {
      console.log(key + ' -> ' + value);
    });
  }

  private visitPath(context: OasContext, name: string, pathItem: Record<string, Webhook | Operation>): IType {
    const operation = pathItem.get;
    if (operation.constructor.name === 'Webhook') {
      throw new Error('Webhook not supported');
    }

    trace(context, '-> [visitPath]', `in:  [${name}] id: ${operation.getOperationId()}`);
    const type = this.visitGet(context, name, operation);
    trace(context, '<- [visitPath]', `out: [${name}] id: ${operation.getOperationId()}`);

    return type;
  }
}
