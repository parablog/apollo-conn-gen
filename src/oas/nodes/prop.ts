import { IType, Obj, Type } from './internal.js';
import { SchemaObject } from 'oas/types';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

export abstract class Prop extends Type {
  public required: boolean = false;
  // the numbered field name when a sibling sanitises to the same one; unset for everyone else. #69
  public renamedTo?: string;

  constructor(
    parent: IType | undefined,
    name: string,
    public schema: SchemaObject,
  ) {
    super(parent, name);
  }

  public generate(context: OasContext, writer: Writer, _selection: string[]): void {
    const description = this.effectiveDescription(context);
    if (description != null) {
      if (
        description.includes('\n') ||
        description.includes('\r') ||
        description.includes('"') ||
        description.includes('\\')
      ) {
        writer.write('  """\n').write('  ').write(description).write('\n  """\n');
      } else {
        writer.write('  "').write(description).write('"\n');
      }
    }

    writer
      .write('  ')
      .write(this.renamedTo ?? Naming.sanitiseField(this.name))
      .write(': ');

    this.generateValue(context, writer);

    if (this.required) {
      writer.write('!');
    }

    writer.write('\n');
  }

  public abstract getValue(context: OasContext): string;

  // The docstring text written above this field. Default: just the field's own OAS description.
  // A subclass that only decides inside getValue() to give up and write JSON overrides this to
  // explain why. e.g. (confluence) PropObj adds a reason here when contributors becomes JSON.
  protected effectiveDescription(_context: OasContext): string | undefined {
    return this.schema.description;
  }

  // the `?` symbol marks a field the API may leave out, so the router stops warning when it does.
  // e.g. (petstore) optional `name?`, while required `id` stays plain and still warns.
  // `skipOptionalMarkers` drops every marker, for a caller composing below 2.15. see #16
  public isOptionalInSelection(context: OasContext): boolean {
    if (context.generateOptions?.skipOptionalMarkers) {
      return false;
    }
    return !this.required && this.parent?.kind !== 'input' && !this.isEntityKey(context);
  }

  // a key of the entity selection being written: the owner type is still on the stack (the same
  // fact writeEntityConnector uses for its indent) and one of its resolvers names this prop,
  // e.g. (entity-resolver) Widget's own @connect keeps `id` plain while its Query fields mark `id?`
  private isEntityKey(context: OasContext): boolean {
    const owner = this.parent;
    if (!(owner instanceof Obj) || context.stack[context.stack.length - 1] !== owner) {
      return false;
    }
    return owner.entityResolvers.some((resolver) => resolver.keyFields.split(' ').includes(this.name));
  }

  generateValue(context: OasContext, writer: Writer): void {
    writer.write(this.getValue(context));
  }

  // The field as the selection writes it: the JSON key aliased to the written name when they differ.
  //   e.g. (trello) foo_bar renamed to fooBar2 -> body `foo_bar: fooBar2`, response `fooBar2: foo_bar`
  protected fieldForSelect(): string {
    return Naming.sanitiseFieldForSelect(this.name, this.parent?.kind === 'input', this.renamedTo);
  }
}
