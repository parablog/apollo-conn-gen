import { IType, Map, Prop } from './internal.js';
import _ from 'lodash';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

export class PropMap extends Prop {
  constructor(
    parent: IType,
    name: string,
    public schema: SchemaObject,
    public map: Map,
  ) {
    super(parent, name, schema);
    if (!map) {
      throw new Error('map parameter is required');
    }

    // Re-parent the map to this property if needed
    if (map.parent !== this) {
      map.parent = this;
    }
  }

  public forPrompt(_context: OasContext): string {
    return '[prop] ' + _.lowerFirst(this.name) + ': ' + Naming.getRefName(this.map.name) + ' (Map)';
  }

  get id(): string {
    return 'prop:map:' + this.name;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      return;
    }

    context.enter(this);
    trace(context, '-> [prop-map:visit]', 'in ' + this.name + ', map: ' + this.map.name);

    this.map.visit(context);
    if (!this.children.includes(this.map)) {
      this.add(this.map);
    }
    this.visited = true;

    trace(context, '<- [prop-map:visit]', 'out ' + this.name + ', map: ' + this.map.name);
    context.leave(this);
  }

  public getValue(context: OasContext): string {
    // For maps, we return the generated map type name as an array without hardcoded required markers
    return '[' + Naming.genTypeName(this.map.name) + this.map.nameSuffix() + ']';
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '-> [prop-map:select]', 'in ' + this.name + ', map: ' + this.map.name);

    const fieldName = this.name;
    const sanitised = Naming.sanitiseFieldForSelect(fieldName);

    // because we are in a map, we need to write the key-value structure
    writer
      .write(' '.repeat(context.indent + context.stack.length))
      .write(sanitised);

    // Add optional chaining operator if field is nullable and option is enabled
    if (context.generateOptions.optionalChaining && !this.required) {
      writer.write('?');
    }

    writer
      .write(': ')
      .write(sanitised);

    // For maps, we need to select the key-value structure
    writer.write('->entries {').write('\n');
    context.enter(this);

    // Generate the key-value selection structure
    writer.write(' '.repeat(context.indent + context.stack.length)).write('key\n');
    writer.write(' '.repeat(context.indent + context.stack.length)).write('value');

    // If the value type has complex structure, we need to expand it
    if (this.map.valueType && this.needsValueSelection()) {
      writer.write(' {').write('\n');
      context.enter(this);
      this.map.valueType.select(context, writer, selection);
      context.leave(this);
      writer.write(' '.repeat(context.indent + context.stack.length)).write('}');
    }
    writer.write('\n');

    context.leave(this);
    writer.write(' '.repeat(context.indent + context.stack.length)).write('}');

    if (context.generateOptions.showParentInSelections) {
      writer.write(' # ').write(Naming.getRefName(this.parent!.name));
    }

    writer.write('\n');

    trace(context, '<- [prop-map:select]', 'out ' + this.name + ', map: ' + this.map.name);
  }

  private needsValueSelection(): boolean {
    return Boolean(this.map.valueType && !this.map.valueType.name?.match(/^(String|Int|Float|Boolean|JSON)$/));
  }

  dependencies(): IType[] {
    return [this.map];
  }

  private needsBrackets(): boolean {
    return Boolean(this.map && this.map.valueType && !_.isEmpty(this.map.props));
  }
}
