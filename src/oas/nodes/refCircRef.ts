import { CircularRef } from './internal.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

/**
 * Construction-time circular-reference sentinel for cycles that close through `Factory.fromSchema`
 * (composition branches, map values, nested refs, array items) — i.e. wherever the recursion vehicle
 * is a *type* rather than a directly-wrapped property (that case uses {@link PropCircRef}).
 *
 * Unlike the legacy {@link CircularRef} (whose `generate` is a no-op, kept that way so v0.3 SDL stays
 * byte-identical), `RefCircRef` renders the cut **commented in BOTH artifacts**: an inert `#` line in the
 * GraphQL SDL and a matching `#` line in the connector selection. A commented member is therefore absent
 * from the resolved schema (no `CONNECTORS_UNRESOLVED_FIELD`) yet self-documents where expansion stopped.
 * `visit`/`add`/`expand` are no-ops (inherited), so it terminates traversal. see docs/issues.md #10
 */
export class RefCircRef extends CircularRef {
  public generate(_context: OasContext, writer: Writer): void {
    writer.write(`# ${Naming.getRefName(this.name)}: circular reference omitted\n`);
  }

  public select(context: OasContext, writer: Writer): void {
    writer
      .write(' '.repeat(context.indent + context.stack.length))
      .write(`# ${Naming.getRefName(this.name)}: circular reference omitted\n`);
  }
}
