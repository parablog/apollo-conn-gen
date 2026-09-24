import { IType, Obj, Type } from './internal.js';
import { SchemaObject } from 'oas/types';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import { ExpandedSelection } from '../utils/expandedSelection.js';

export abstract class Prop extends Type {
  public required: boolean = false;

  constructor(
    parent: IType | undefined,
    name: string,
    public schema: SchemaObject,
  ) {
    super(parent, name);
  }

  // `fieldName` is the name the writing type gives this field, a twin's number included. #69 #242
  //   e.g. (confluence) LookAndFeel.links -> links, never a number another type gave it
  public generate(context: OasContext, writer: Writer, _selection: ExpandedSelection, fieldName?: string): void {
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
      .write(fieldName ?? Naming.sanitiseField(this.name, context.generateOptions?.keepFieldNames === true))
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
  protected effectiveDescription(context: OasContext): string | undefined {
    const note = this.findLinkTargetsNote(context);
    const own = this.schema.description;
    return note && own ? `${own} ${note}` : (note ?? own);
  }

  // Returns the sentence a "$links" target list adds, so a reader knows where the id points when
  // no single link can be written (no union under a field). see docs/FIXED.md #249
  //   e.g. (entity-link-overrides) Task.MemberId -> ["Group", "Member"]: "Links to Group or Member."
  private findLinkTargetsNote(context: OasContext): string | undefined {
    const owner = this.parent;
    if (!context.generateOptions?.inferEntityResolvers || !(owner instanceof Obj) || owner.kind === 'input') {
      return undefined;
    }
    const targets =
      context.generateOptions.overrides?.$links?.[`${Naming.getRefName(owner.name)}.${this.name}`]?.target;
    if (!Array.isArray(targets)) {
      return undefined;
    }
    return `Links to ${targets.slice(0, -1).join(', ')} or ${targets[targets.length - 1]}.`;
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
  protected fieldForSelect(context: OasContext, fieldName?: string): string {
    return Naming.sanitiseFieldForSelect(
      this.name,
      this.parent?.kind === 'input',
      fieldName,
      context.generateOptions?.keepFieldNames === true,
    );
  }

  // The selection head every prop writer starts with: indent, sanitised name, a self-alias when
  // `suffix`/`alwaysAlias` needs one and the name carried none of its own, `?`, then `suffix`.
  //   e.g. (ashby) `value: value?->echo({ raw: @ })` (PropComp, suffix set)
  protected writeFieldHead(
    context: OasContext,
    writer: Writer,
    options: { suffix?: string; alwaysAlias?: boolean; optional?: boolean; fieldName?: string } = {},
  ): void {
    const sanitised = this.fieldForSelect(context, options.fieldName);
    const optional = options.optional ?? this.isOptionalInSelection(context);

    writer.write(' '.repeat(context.indent + context.stack.length)).write(sanitised);
    if ((options.suffix || options.alwaysAlias) && sanitised === this.name) {
      writer.write(': ').write(sanitised);
    }
    if (optional) {
      writer.write('?');
    }
    if (options.suffix) {
      writer.write(options.suffix);
    }
  }
}
