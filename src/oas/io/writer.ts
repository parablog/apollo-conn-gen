import { OasGen } from '../oasGen.js';
import { IType, T } from '../nodes/internal.js';
import { inferEntityResolvers } from '../nodes/entity.js';
import { promoteInterfaces } from '../nodes/interfacePromotion.js';
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

  /** Run `fn` against a fresh buffer and return what it wrote, restoring the original buffer. */
  public capture(fn: () => void): string {
    const saved = this.buffer;
    this.buffer = [];
    try {
      fn();
      return this.buffer.join('');
    } finally {
      this.buffer = saved;
    }
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

    // make our own copy of the refCount, so it doesn't get modified by the writing process
    const refCount = _.cloneDeep(context.refCount);

    // Attach entity resolvers onto the (single, canonical) collected type instances the
    // loop below generates, so each entity type can emit @key + its type-level
    // @connect/$this resolver. Resets first, so it's a no-op when the flag is off.
    inferEntityResolvers(context, this.gen, types, selection);

    // R2: promote discriminated oneOf-with-shared-allOf-base to a GraphQL interface (id-neutral;
    // no-op unless consolidateUnions is off and a qualifying union exists). Same `types` map.
    promoteInterfaces(context, this.gen, types, selection);

    // R10: before any @mapping body is emitted, mark the spread-graph back edges that must
    // render inline — recursive schemas would otherwise produce a cyclic @mapping graph.
    if (context.generateOptions.reusableMappings) {
      T.computeInlinedMappingEdges(types, selection, context);
    }

    this.schemaWriter.writeDirectives(writer);
    this.schemaWriter.writeJSONScalar(writer);

    types.forEach((type: IType) => {
      const count = refCount.get(type.name) !== undefined ? refCount.get(type.name)! : Infinity;

      if (!generatedSet.has(type.id) && count > 0) {
        type.generate(context, this, selection);
        generatedSet.add(type.id);
        refCount.set(type.name, count - 1);
      }
    });

    const expanded = [...this.gen.paths];

    const queries = new Map(expanded.filter(([_k, type]) => type.id.startsWith('get:')));
    const mutations = new Map(expanded.filter(([_k, type]) => T.isMutationType(type)));

    this.operationWriter.writeQuery(context, writer, queries, selection);
    this.operationWriter.writeMutations(context, writer, mutations, selection);

    writer.flush();
  }
}
