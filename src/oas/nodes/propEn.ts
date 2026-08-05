import { SchemaObject } from 'oas/types';
import { En, IType, Prop } from './internal.js';
import { Writer } from '../io/writer.js';
import { OasContext } from '../oasContext.js';
import { Naming } from '../utils/naming.js';
import { trace } from '../log/trace.js';

export class PropEn extends Prop {
  // the enum definition itself, so a rename before store (#57) is seen here at write time too
  constructor(
    parent: IType,
    name: string,
    private en: En,
    schema: SchemaObject,
  ) {
    super(parent, name, schema);
  }

  get id(): string {
    return 'prop:enum:' + this.name;
  }

  generate(context: OasContext, writer: Writer, _selection: string[]) {
    super.generate(context, writer, _selection);
  }

  // Reaching the field reaches its definition — the enum names itself on first visit (#57), and an
  // explicit selection path stops here rather than at the `En`. Mirrors PropObj.visit.
  // e.g. (js-mva-homepage-product-selector_v3.yaml) usageType -> enum UsageSummaryItemUsageType
  public visit(context: OasContext): void {
    if (this.visited) {
      return;
    }
    this.en.visit(context);
    this.visited = true;
  }

  public forPrompt(context: OasContext): string {
    return `[prop] enum: ${Naming.getRefName(this.en.name)}`;
  }

  public getValue(_context: OasContext): string {
    // same name derivation as the En definition (def/ref agreement, see #15 / en.ts)
    const sanitised = Naming.genTypeName(this.en.name);
    const refName = Naming.getRefName(this.en.name);
    return sanitised === refName ? refName : sanitised;
  }

  dependencies(): IType[] {
    return Array.from(this.children.values());
  }

  public select(context: OasContext, writer: Writer, selection: string[]): void {
    trace(context, '   [prop:select]', this.name);
    const sanitised = Naming.sanitiseFieldForSelect(this.name, this.parent?.kind === 'input');
    writer.write(' '.repeat(context.indent + context.stack.length)).write(sanitised);

    if (context.generateOptions.showParentInSelections) {
      writer.write(' # ').write(Naming.getRefName(this.parent!.name));
    }

    writer.write('\n');
  }
}
