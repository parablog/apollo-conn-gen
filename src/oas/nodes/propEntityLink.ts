import { IType, Obj, Prop } from './internal.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

// A key-only reference field discovered by inferEntityLinks: any other selected type carrying a
// matching scalar field gains this. e.g. (entity-link) Song.album_id -> Song.album: Album. see docs/FIXED.md #161
export class PropEntityLink extends Prop {
  constructor(
    parent: Obj,
    name: string,
    public target: Obj,
    public targetKeyProp: Prop,
    public sourceProp: Prop,
  ) {
    super(parent, name, sourceProp.schema);
    this.required = sourceProp.required;
  }

  // host-qualified so two different types adding a same-named link (e.g. Song and Playlist both
  // adding `album`) get distinct ids.
  get id(): string {
    return `prop:entity-link:${this.parent!.id}:${this.name}`;
  }

  // the target is already visited; this prop is created post-collect, never walked by the
  // normal OAS traversal.
  public visit(_context: OasContext): void {
    this.visited = true;
  }

  public forPrompt(_context: OasContext): string {
    return `[prop] ${this.name}: ${Naming.getRefName(this.target.name)} (entity link)`;
  }

  public getValue(_context: OasContext): string {
    return Naming.genTypeName(this.target.name) + this.target.nameSuffix();
  }

  dependencies(): IType[] {
    return [this.target];
  }

  // a key-only stub, not real nested JSON -- hand-written instead of PropObj's recursive form.
  // e.g. Song.album_id -> `album: { albumId: album_id }`, letting the router complete the entity
  // via Album's own type-level resolver.
  public select(context: OasContext, writer: Writer, _selection: string[]): void {
    const keep = context.generateOptions?.keepFieldNames === true;
    const base = context.indent + context.stack.length;
    const name = this.renamedTo ?? Naming.sanitiseField(this.name, keep);
    // the key must match the target's @key, which now honors a twin rename too. see docs/FIXED.md #168
    const sourceRef = Naming.sanitiseFieldForSelect(this.sourceProp.name, false, this.targetKeyProp.renamedTo, keep);

    writer
      .write(' '.repeat(base))
      .write(name)
      .write(': {\n')
      .write(' '.repeat(base + 2))
      .write(sourceRef)
      .write('\n')
      .write(' '.repeat(base))
      .write('}\n');
  }
}
