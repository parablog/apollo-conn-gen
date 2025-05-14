import { OasGen } from '../oasGen.js';
import { IType, T } from '../nodes/internal.js';
import { OperationWriter } from './operationWriter.js';
import { SchemaWriter } from './schemaWriter.js';
import { TypesCollector } from '../generator/typesCollector.js';
import _ from 'lodash';

export class Writer {
  private schemaWriter: SchemaWriter;
  private operationWriter: OperationWriter;
  public buffer: string[];

  constructor(public gen: OasGen) {
    this.buffer = [];
    this.schemaWriter = new SchemaWriter(gen);
    this.operationWriter = new OperationWriter(gen);
  }

  public write(input: string): Writer {
    this.buffer.push(input);
    return this;
  }

  public flush(): string {
    return this.buffer.join('');
  }

  public generate(paths: string[]): string[] {
    const collector = new TypesCollector(this.gen);
    collector.collect(paths);

    return this.generateWith(collector.types, collector.expanded);
  }

  public generateWith(types: Map<string, IType>, selection: string[]) {
    this.writeSchema(this, types, selection);
    return selection;
  }

  public writeSchema(writer: Writer, types: Map<string, IType>, selection: string[]): void {
    const context = this.gen.context!;
    const generatedSet = context.generatedSet;

    this.schemaWriter.writeDirectives(writer);
    this.schemaWriter.writeJSONScalar(writer);

    types.forEach((type: IType) => {
      const count = context.refCount.get(type.name) !== undefined ? context.refCount.get(type.name)! : Infinity;

      if (!generatedSet.has(type.id) && count > 0) {
        type.generate(context, this, selection);
        generatedSet.add(type.id);
      }

      context.decRefCount(type.name);
    });

    const expanded = [...this.gen.paths];

    const queries = new Map(expanded.filter(([_k, type]) => type.id.startsWith('get:')));
    const mutations = new Map(expanded.filter(([_k, type]) => T.isMutationType(type)));

    this.operationWriter.writeQuery(context, writer, queries, selection);
    this.operationWriter.writeMutations(context, writer, mutations, selection);

    writer.flush();
  }
}
