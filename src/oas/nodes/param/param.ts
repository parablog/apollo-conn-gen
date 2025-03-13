import { ParameterObject, SchemaObject } from 'oas/types';
import { trace } from '../../log/trace.js';
import { OasContext } from '../../oasContext.js';
import { Writer } from '../../io/writer.js';
import { Naming } from '../../utils/naming.js';
import { Factory } from '../factory.js';
import { IType, Type } from '../type.js';

export class Param extends Type {
  public resultType!: IType;

  constructor(
    parent: IType,
    name: string,
    public schema: SchemaObject,
    public required: boolean,
    public defaultValue: unknown,
    public parameter: ParameterObject,
  ) {
    super(parent, name);
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      return;
    }

    context.enter(this);
    trace(context, '-> [param:visit]', 'in: ' + this.name);

    this.resultType = Factory.fromSchema(this, this.schema);
    trace(context, '   [param:visit]', 'type: ' + this.resultType);
    this.resultType.visit(context);

    trace(context, '<- [param:visit]', 'out: ' + this.name);
    context.leave(this);
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(this);
    trace(context, '-> [param::generate]', `-> in: ${this.name}`);

    writer.write(Naming.genParamName(this.name));
    writer.write(': ');

    this.resultType.generate(context, writer, selection);

    if (this.required) {
      writer.write('!');
    }

    if (this.defaultValue !== null && this.defaultValue !== undefined) {
      this.writeDefaultValue(writer);
    }

    trace(context, '<- [param::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  public forPrompt(context: OasContext): string {
    return `Param{ name=${this.name}, required=${this.required}, defaultValue=${this.defaultValue}, props=${this.props}, resultType=${this.resultType} }`;
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    // do nothing
  }

  private writeDefaultValue(writer: Writer): void {
    writer.write(' = ');
    const value = this.defaultValue;

    if (typeof value === 'number') {
      writer.write(value.toString());
    } else if (typeof value === 'string') {
      writer.write('"');
      writer.write(String(value));
      writer.write('"');
    }
  }
}
