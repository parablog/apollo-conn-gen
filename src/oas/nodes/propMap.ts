import { IType, Map, Prop } from './internal.js';
import _ from 'lodash';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import { ExpandedSelection } from '../utils/expandedSelection.js';

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

  public select(context: OasContext, writer: Writer, selection: ExpandedSelection, path: string) {
    trace(context, '-> [prop-map:select]', 'in ' + this.name + ', map: ' + this.map.name);

    // alwaysAlias: the local pre-release composer only accepts `->entries` behind `name: name`,
    // never a bare `name`; a field that already carries a real alias is unaffected. see docs/FIXED.md #42
    this.writeFieldHead(context, writer, { alwaysAlias: true });
    this.map.selectEntries(context, writer, selection, Naming.pathUnder(path, this.map.id));

    if (context.generateOptions.showParentInSelections) {
      writer.write(' # ').write(Naming.getRefName(this.parent!.name));
    }

    writer.write('\n');

    trace(context, '<- [prop-map:select]', 'out ' + this.name + ', map: ' + this.map.name);
  }

  dependencies(): IType[] {
    return [this.map];
  }

  private needsBrackets(): boolean {
    return Boolean(this.map && this.map.valueType && !_.isEmpty(this.map.props));
  }
}
