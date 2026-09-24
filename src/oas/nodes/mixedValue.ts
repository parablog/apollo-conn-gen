import _ from 'lodash';
import { SchemaObject } from 'oas/types';
import { Obj, Prop, PropArray, PropCircRef, PropObj, PropScalar, Scalar, Union } from './internal.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { MixedValueShape } from '../utils/schemas.js';
import { Naming } from '../utils/naming.js';
import { ExpandedSelection } from '../utils/expandedSelection.js';

// The fields a mixed value is split into: one for each shape the oneOf allows (text, number,
// boolean, list, object), only when it allows it, plus `raw` for the value as it arrived. see docs/FIXED.md #208
//   e.g. (ashby) OverlayCustomField.value: oneOf [boolean, {currencyCode, value}, string] -> boolean, object, text, raw
export interface MixedValueFields {
  text?: PropScalar; // String: string and enum members
  number?: PropScalar; // Float: Int and Float members
  boolean?: PropScalar;
  list?: PropArray; // items String when every array member has string items, else JSON
  object?: PropObj; // `<Union>Object`: clones of the selected object member fields, all optional
  raw: PropScalar; // JSON
}

// Builds and writes those fields for a mixed-value union, plus the `<Union>Object` type that holds
// the selected fields of its object members, all optional. see docs/FIXED.md #208
export class MixedValue {
  public fields: MixedValueFields;
  public objectType?: Obj;
  private readonly hasObjectMember: boolean;

  constructor(
    private readonly union: Union,
    shape: MixedValueShape,
    context: OasContext,
    selection: ExpandedSelection,
    // Lists the routes the union is reached on; the object type holds the fields any of them selects
    //   e.g. (shared-union-fields.yaml) R on get:/m's and get:/o's price
    public readonly routes: string[],
  ) {
    this.hasObjectMember = shape.objectMemberIndexes.length > 0;
    this.fields = { raw: new PropScalar(union, 'raw', 'JSON', {}) };
    this.fields.raw.visit(context);

    if (shape.isText) {
      this.fields.text = new PropScalar(union, 'text', 'String', { type: 'string' });
      this.fields.text.visit(context);
    }
    if (shape.isBoolean) {
      this.fields.boolean = new PropScalar(union, 'boolean', 'Boolean', { type: 'boolean' });
      this.fields.boolean.visit(context);
    }
    if (shape.isNumber) {
      this.fields.number = new PropScalar(union, 'number', 'Float', { type: 'number' });
      this.fields.number.visit(context);
    }
    if (shape.listItemType) {
      const list = new PropArray(union, 'list', { type: 'array', items: {} });
      const itemSchema: SchemaObject = shape.listItemType === 'String' ? { type: 'string' } : {};
      list.setItems(new Scalar(list, shape.listItemType, itemSchema));
      list.visit(context);
      this.fields.list = list;
    }
    if (this.hasObjectMember) {
      this.objectType = this.buildObjectType(context, shape, selection, routes);
      // an empty type isn't written (rover rejects it) — the "{" match branch still claims the
      // prefix regardless, see writeSelection.
      if (this.objectType.props.size > 0) {
        this.fields.object = new PropObj(union, 'object', { type: 'object' }, this.objectType);
      }
    }
  }

  // Registered exactly like any other object (name-collision check included, #208). Each clone is
  // owned by the object type but keeps its member field's own path (Type.pathInSelection). The
  // written route's fields come first; a field only another route selects is cloned too, so that
  // route's selection still writes it, as when each op built its own copy. #242
  //   e.g. (shared-union-fields.yaml) /m selects amount, /o rate.value -> clones amount and rate
  private buildObjectType(
    context: OasContext,
    shape: MixedValueShape,
    selection: ExpandedSelection,
    routes: string[],
  ): Obj {
    const objectType = new Obj(this.union, `${this.union.name}Object`, { type: 'object', properties: {} });
    objectType.visit(context);

    const writtenRoute = selection.writtenPath(this.union);
    for (const unionPath of [writtenRoute, ...routes.filter((route) => route !== writtenRoute)]) {
      this.addObjectFields(context, shape, selection, objectType, unionPath);
    }
    return objectType;
  }

  // Clones onto the object type each field the object members select when the union sits at
  // `unionPath`, merged by name as one op's copy always was; a name already cloned is kept.
  //   e.g. (nested-oneof-branch-loss.yaml) value's Currency member -> ValueUnionObject { currencyCode value }
  private addObjectFields(
    context: OasContext,
    shape: MixedValueShape,
    selection: ExpandedSelection,
    objectType: Obj,
    unionPath: string,
  ): void {
    const members = shape.objectMemberIndexes
      .map((i) => this.union.children[i])
      .filter((member) => this.union.findMembersOn(unionPath).includes(member));
    const candidates = members.flatMap((member) => this.union.findMemberFields(member, selection, unionPath));
    const pathByName = new Map<string, string>();
    for (const candidate of candidates) {
      if (!pathByName.has(candidate.prop.name)) pathByName.set(candidate.prop.name, candidate.path);
    }

    const keep = context.generateOptions?.keepFieldNames === true;
    for (const { prop } of Union.dedupeByName(candidates, context, keep, this.union, unionPath)) {
      if (objectType.props.has(prop.name)) {
        continue;
      }
      const clone = _.clone(prop) as Prop;
      clone.children = [...prop.children];
      clone.required = false;
      clone.parent = objectType;
      clone.pathInSelection = pathByName.get(prop.name);
      // Marks the clone selected when a selected member field carries its name: the walk never
      // passed the clone, and a merged field is a new prop. e.g. (nested-oneof-branch-loss.yaml) currencyCode
      if (clone.pathInSelection) selection.nodesWithLeaves.add(clone);
      objectType.props.set(clone.name, clone);
      objectType.add(clone);
      // Leaves out on the object type too a member field the loop walk left out on this union. #242
      if (this.union.emittedProp(context, prop) instanceof PropCircRef) {
        context.commentOutField(objectType, clone, clone.name);
      }
    }
  }

  // Writes the type with one field per kind present, in kind order. `<Name>Object` is not written
  // here: the collector reaches it through dependencies() and writes it on its own.
  //   e.g. (ashby) type ValueUnion { text: String boolean: Boolean object: ValueUnionObject raw: JSON }
  public generate(context: OasContext, writer: Writer, name: string): void {
    writer
      .write(this.union.kind + ' ')
      .write(name)
      .write(this.union.nameSuffix())
      .write(' {\n');
    for (const prop of [
      this.fields.text,
      this.fields.number,
      this.fields.boolean,
      this.fields.list,
      this.fields.object,
      this.fields.raw,
    ]) {
      if (prop) prop.generate(context, writer, new ExpandedSelection([]));
    }
    writer.write('}\n\n');
  }

  // Writes the selection that sorts the value into its field: a match on the first character
  // of the JSON text, one branch per shape present, a catch-all last, then `raw` itself.
  //   e.g. (ashby) ... raw->jsonStringify->slice(0, 1)->match(["\"", { text: raw }], ["t", { boolean: raw }], …) raw
  public writeSelection(context: OasContext, writer: Writer, selection: ExpandedSelection, path: string): void {
    const fields = this.fields;
    const pad = (n: number) => ' '.repeat(Math.max(n, 0));
    const base = context.indent + context.stack.length;

    type Branch = { prefix: string; write: () => void };
    const branches: Branch[] = [];
    if (fields.text) branches.push({ prefix: '"\\""', write: () => writer.write('{ text: raw }') });
    if (fields.boolean) {
      branches.push({ prefix: '"t"', write: () => writer.write('{ boolean: raw }') });
      branches.push({ prefix: '"f"', write: () => writer.write('{ boolean: raw }') });
    }
    if (fields.list) branches.push({ prefix: '"["', write: () => writer.write('{ list: raw }') });
    if (this.hasObjectMember) {
      branches.push({
        prefix: '"{"',
        write: () => {
          if (!fields.object) {
            // no object field selected: still claim the "{" prefix so a real object payload can't
            // fall through to the number catch-all below.
            writer.write('{}');
            return;
          }
          const objType = fields.object.obj as Obj;
          writer.write('{ object: raw {\n');
          context.enter(fields.object);
          // each cloned field writes itself, so `?` follows the usual rule (skipOptionalMarkers, prop.ts)
          objType.select(context, writer, selection, Naming.pathUnder(path, fields.object.id, objType.id));
          context.leave(fields.object);
          writer.write(pad(base + 2)).write('} }');
        },
      });
    }
    // A number has no single leading character, so it gets one arm per digit (and `-`) instead of
    // the catch-all — `->typeof` composed to unresolved fields on stock 2.15.1, runtime-checked.
    //   e.g. (oneOf: [number, object, {}]) a string body with no text member: `[@, {}]`, not `number`.
    if (fields.number) {
      for (const digit of ['-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
        branches.push({ prefix: `"${digit}"`, write: () => writer.write('{ number: raw }') });
      }
    }
    branches.push({ prefix: '@', write: () => writer.write('{}') });

    writer.write(pad(base)).write('... raw->jsonStringify->slice(0, 1)->match(\n');
    branches.forEach((branch, idx) => {
      writer.write(pad(base + 2)).write(`[${branch.prefix}, `);
      branch.write();
      writer.write(']').write(idx < branches.length - 1 ? ',\n' : '\n');
    });
    writer.write(pad(base)).write(')\n');
    writer.write(pad(base)).write('raw\n');
  }

  public dependencies(): (PropScalar | PropArray | PropObj)[] {
    const { text, number, boolean, list, object, raw } = this.fields;
    return [text, number, boolean, list, object, raw].filter((p): p is PropScalar | PropArray | PropObj => p != null);
  }

  // The whole value is read once and sorted by shape. see docs/FIXED.md #208
  public selectionSuffix(): string {
    return '->echo({ raw: @ })';
  }
}
