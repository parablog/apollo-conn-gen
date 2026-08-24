// Marker pair around a block of hand-written text: `# === CUSTOM <name> === ... # === END CUSTOM
// <name> ===`. A person adds one of these around content the generator can't produce on its own
// (e.g. a field the real API returns that its own OpenAPI spec omits), so it survives the next
// regeneration instead of being silently overwritten.
const START = (name: string) => new RegExp(`^([ \\t]*)# === CUSTOM ${name} ===[ \\t]*$`, 'm');
const END = (name: string) => new RegExp(`^[ \\t]*# === END CUSTOM ${name} ===[ \\t]*$`, 'm');

export class Regions {
  // The only region names a marker is allowed to carry. Splicing in an insertion point for a
  // sixth name would mean guessing where hand-written content should go with no real example to
  // check the guess against — refuse instead. see docs/FIXED.md #140
  public static readonly KNOWN = [
    'extra-links',
    'extra-sources',
    'extra-types',
    'extra-query-fields',
    'extra-mutation-fields',
  ] as const;

  // Read every `# === CUSTOM <name> === ... # === END CUSTOM <name> ===` block out of a
  // generated file, dedenting each body line by the start marker's own indentation so it always starts at column 0.
  //   e.g. a marker 2 spaces deep inside `type Query { }`, body '  field: Int'  ->  'field: Int'
  public static extract(content: string): Record<string, string> {
    const regions: Record<string, string> = {};
    for (const name of Regions.KNOWN) {
      const start = START(name).exec(content);
      if (!start) continue;
      const end = END(name).exec(content);
      if (!end) {
        throw new Error(`[Regions.extract] CUSTOM region "${name}" is missing its END marker`);
      }
      const bodyStart = start.index + start[0].length + 1; // +1 skips the newline after the start marker
      const rawBody = content.slice(bodyStart, end.index).replace(/\n$/, '');
      const markerIndent = start[1];
      regions[name] = markerIndent
        ? rawBody
            .split('\n')
            .map((line) => (line.startsWith(markerIndent) ? line.slice(markerIndent.length) : line))
            .join('\n')
        : rawBody;
    }

    // A marker naming anything outside the known five is a typo or a made-up name — flag it by
    // name instead of quietly leaving its content out of `regions`.
    const unknownMatch = /^[ \t]*# === CUSTOM ([^\s=][^=]*?) ===[ \t]*$/m.exec(content);
    if (unknownMatch && !(Regions.KNOWN as readonly string[]).includes(unknownMatch[1])) {
      throw new Error(`[Regions.extract] unknown CUSTOM region "${unknownMatch[1]}"`);
    }

    return regions;
  }

  // Insert each non-empty extracted body into a freshly generated schema, re-wrapped in its own
  // markers so that running `extract` on the result recovers the same bodies again.
  //
  // Given the `extra-types`/`extra-query-fields` bodies extracted above, and a fresh schema:
  //   type Acme_Widget {
  //     id: ID
  //   }
  //
  //   type Query {
  //     acme_getWidget: Acme_Widget
  //   }
  //
  // `splice` inserts the hand-authored type before `type Query {`, and the hand-authored field
  // as another field inside Query, each still wrapped in its markers.
  //
  // Only `extra-types` and `extra-query-fields` have a real insertion point implemented, because
  // those are the only two any committed schema actually uses today. A non-empty region outside
  // those two — known or not — throws naming the region, rather than guess where it belongs.
  public static splice(skeleton: string, regions: Record<string, string>): string {
    let result = skeleton;

    for (const [name, body] of Object.entries(regions)) {
      if (!body) continue;

      if (!(Regions.KNOWN as readonly string[]).includes(name)) {
        throw new Error(`[Regions.splice] unknown CUSTOM region "${name}"`);
      }

      const wrapped = `# === CUSTOM ${name} ===\n${body}\n# === END CUSTOM ${name} ===`;

      if (name === 'extra-types') {
        result = Regions.spliceBeforeRootType(result, wrapped);
      } else if (name === 'extra-query-fields') {
        result = Regions.spliceIntoRootType(result, 'Query', wrapped, name);
      } else {
        throw new Error(`[Regions.splice] no insertion point implemented yet for CUSTOM region "${name}"`);
      }
    }

    return result;
  }

  // `extra-types` goes right before whichever of `type Query {`/`type Mutation {` appears first,
  // so hand-authored types are defined before anything references them, matching where a person
  // would naturally read them.
  private static spliceBeforeRootType(content: string, wrapped: string): string {
    const queryIndex = content.indexOf('type Query {');
    const mutationIndex = content.indexOf('type Mutation {');
    const candidates = [queryIndex, mutationIndex].filter((i) => i >= 0);
    if (candidates.length === 0) {
      throw new Error('[Regions.splice] no "type Query {" or "type Mutation {" found to splice extra-types before');
    }
    const insertAt = Math.min(...candidates);
    return content.slice(0, insertAt) + wrapped + '\n\n' + content.slice(insertAt);
  }

  // `extra-query-fields`/`extra-mutation-fields` go as one more field inside their root type,
  // just before its closing `}` — after `acme_getWidget: Acme_Widget`, still inside the same
  // `type Query { ... }` block.
  private static spliceIntoRootType(content: string, rootType: string, wrapped: string, regionName: string): string {
    const typeStart = content.indexOf(`type ${rootType} {`);
    if (typeStart < 0) {
      throw new Error(`[Regions.splice] no "type ${rootType} {" found to splice ${regionName} into`);
    }
    const closeBrace = content.indexOf('\n}', typeStart);
    if (closeBrace < 0) {
      throw new Error(`[Regions.splice] "type ${rootType} {" has no closing "}" to splice ${regionName} before`);
    }
    const indented = wrapped
      .split('\n')
      .map((line) => '  ' + line)
      .join('\n');
    return content.slice(0, closeBrace) + '\n' + indented + content.slice(closeBrace);
  }
}
