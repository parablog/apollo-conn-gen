import { OasGen } from '../oasGen.js';
import { IType, T } from '../nodes/internal.js';
import { inferEntityResolvers } from '../nodes/entity.js';
import { applyBatchResolvers } from '../nodes/batch.js';
import { promoteAllOfBase } from '../nodes/allOfBase.js';
import { OperationWriter } from './operationWriter.js';
import { SchemaWriter } from './schemaWriter.js';
import { SecurityPlan } from './security.js';
import { TypesCollector } from '../generator/typesCollector.js';
import { Naming } from '../utils/naming.js';
import _ from 'lodash';

export class Writer {
  private schemaWriter: SchemaWriter;
  private operationWriter: OperationWriter;
  public buffer: string[];

  constructor(public gen: OasGen) {
    this.buffer = [];
    // resolve the spec's security once (schemes, global requirement, per-op mode) and share it —
    // schemaWriter (@source) and operationWriter (per-@connect) both query it instead of re-walking
    // the whole spec per operation.
    const security = SecurityPlan.from(gen.parser, {
      skipAuth: gen.options.skipAuth,
      authValuePrefix: gen.options.authValuePrefix,
    });
    this.schemaWriter = new SchemaWriter(gen, security);
    this.operationWriter = new OperationWriter(gen, security);
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

    // make our own copy of the refCount, so it doesn't get modified by the writing process
    const refCount = _.cloneDeep(context.refCount);

    // Attach entity resolvers onto the (single, canonical) collected type instances the
    // loop below generates, so each entity type can emit @key + its type-level
    // @connect/$this resolver. Resets first, so it's a no-op when the flag is off.
    inferEntityResolvers(context, this.gen, types, selection);

    // R6: add batch resolvers (needs the R1 @key above) when a --batch file was given.
    applyBatchResolvers(context, this.gen, types);

    // R2: promote discriminated oneOf-with-shared-allOf-base to a GraphQL interface (id-neutral;
    // no-op unless a qualifying discriminated output union exists). Same `types` map.
    promoteAllOfBase(context, this.gen, types, selection);

    this.schemaWriter.writeDirectives(writer);
    this.schemaWriter.writeJSONScalar(writer);

    types.forEach((type: IType) => {
      if (!type.name) {
        // Box `metadata_query_indices` has `MetadataQueryIndex.fields.items` as an inline allOf.
        // That node must be named `Fields` before the writer can emit `type Fields { ... }`.
        throw new Error(
          `[writer] cannot emit a GraphQL definition without a name: id=${type.id}. ` +
            `Name the type where it is created.`,
        );
      }

      const count = refCount.get(type.name) !== undefined ? refCount.get(type.name)! : Infinity;

      // `generatedSet` is keyed by internal id, but two ids can print the same GraphQL type.
      // Launch Library reaches `AgencyMini` as both `obj:type:...AgencyMini` (`program.agencies`)
      // and `comp:type:...AgencyMini` (`mission_patches.agency`). Track the printed name too, so
      // `type AgencyMini` is emitted once. Keep the kind suffix because output `Pet` and input
      // `PetInput` can both come from the same $ref.
      const nameKey = T.isRef(type.name)
        ? 'name:' + Naming.genTypeName(type.name) + (type.kind === 'input' ? 'Input' : '')
        : null;

      if (!generatedSet.has(type.id) && !(nameKey && generatedSet.has(nameKey)) && count > 0) {
        type.generate(context, this, selection);
        generatedSet.add(type.id);
        if (nameKey) generatedSet.add(nameKey);
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
