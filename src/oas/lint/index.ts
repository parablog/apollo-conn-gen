import type { OasGen } from '../oasGen.js';
import type { LintDiagnostic, ParsedSchema } from './types.js';
import { SchemaReader } from './schemaReader.js';
import { ArrowTargetCheck } from './checks/arrowTarget.js';
import { PathInResponseCheck } from './checks/pathInResponse.js';
import { trace } from '../log/trace.js';

export type {
  LintDiagnostic,
  LintFix,
  Severity,
  ParsedSchema,
  Selection,
  SelectedField,
  SelectionPlace,
} from './types.js';
export { SchemaReader } from './schemaReader.js';
export { ArrowMethods } from './arrowMethods.js';
export { ResponseShape } from './responseShape.js';

/** A check reads the schema and says what is wrong with it. */
type Check = (schema: ParsedSchema, gen?: OasGen) => LintDiagnostic[];

// Checks that apply to any connector selection. The v0.5 branch adds its @mapping checks to this
// list; keeping the list in one place is what lets that merge come down without a conflict.
const CHECKS: Check[] = [ArrowTargetCheck.run, PathInResponseCheck.run];

/**
 * Check the connector selections in an SDL document, e.g. the `id name category { id name }` inside
 * a `@connect(selection:)`. Positions in the result are offsets into `sdl`, so the editor can
 * underline them directly.
 *
 * Pass `gen` when a spec is loaded — the checks that compare a path against the real response only
 * run then, and say nothing otherwise.
 *
 * These rules are also enforced by the router, so the two can drift apart. The method list in
 * arrowMethods.ts is the piece most likely to go stale.
 */
export function lintSelections(sdl: string, gen?: OasGen): LintDiagnostic[] {
  // one line per run, not per field: this runs on every keystroke in the editor
  trace(null, '-> [lint:selections]', `in: ${sdl.length} chars`);
  const schema = SchemaReader.read(sdl);
  const found = schema.unreadable ? [] : CHECKS.flatMap((check) => check(schema, gen));
  found.sort((left, right) => left.from - right.from);
  trace(null, '<- [lint:selections]', `out: ${found.length} found`);
  return found;
}
