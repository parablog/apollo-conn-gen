import type { DirectiveText } from './directiveText.js';
import type { MethodCall, NamedSpan, SelectedField, SelectionPlace, ValueSource } from './types.js';

/**
 * Reads the text inside a `selection:` argument into the fields it selects.
 *
 * A petstore `@connect` selection reads as four fields, one of them with a block:
 *
 *   id
 *   name
 *   photoUrls->first
 *   category { id name }
 *
 * This is not the router's parser and does not try to be. It only works out enough to answer, for
 * each field: what it is called, what it reads from, and which methods it calls.
 *
 * The user is usually still typing, so anything that does not read cleanly is marked unreadable and
 * the rest of that selection is left alone — a half-finished line must not produce a complaint.
 */
export class SelectionReader {
  private static readonly NAME_FIRST = /[A-Za-z_]/;
  private static readonly NAME_REST = /[A-Za-z0-9_]/;

  private at = 0;

  private constructor(private readonly source: DirectiveText) {}

  /**
   * Read a whole `selection:` argument. `place` says which directive it came from, because `$` and
   * `@` mean different things in a @connect and in a @mapping.
   */
  public static read(source: DirectiveText, place: SelectionPlace): SelectedField[] {
    const reader = new SelectionReader(source);
    return reader.readFields(reader.readDefinitionHeader(place));
  }

  // `clamp: "($low, $high) => @->min($high)"` starts with a bracketed list and an arrow. Everything
  // after that is the definition's own body, where `@` is what the definition was applied to.
  private readDefinitionHeader(place: SelectionPlace): SelectionPlace {
    this.skipBlanks();
    if (this.peek() !== '(') {
      return place;
    }
    const before = this.at;
    const closed = this.skipBrackets('(', ')');
    this.skipBlanks();
    if (closed && this.text.startsWith('=>', this.at)) {
      this.at += 2;
      return 'definitionBody';
    }
    this.at = before;
    return place;
  }

  private readFields(place: SelectionPlace): SelectedField[] {
    const fields: SelectedField[] = [];
    for (;;) {
      this.skipBlanks();
      if (this.done || this.peek() === '}') {
        return fields;
      }
      const field = this.readField(place);
      fields.push(field);
      if (field.unreadable) {
        return fields; // stop at the first thing we could not read
      }
    }
  }

  private readField(place: SelectionPlace): SelectedField {
    const start = this.at;

    // `...@->Category` merges another shape in without giving it a name
    if (this.text.startsWith('...', this.at)) {
      this.at += 3;
      this.skipBlanks();
      const readsFrom = this.readValueSource();
      const methods = this.readMethods();
      if (!readsFrom || !methods || !this.skipFallbacks()) {
        return this.unreadableField(place, start);
      }
      return this.field({ isMerge: true, readsFrom, methods, place, start });
    }

    // `$->Pet` or `@->Pet` on its own: the whole selection is one value, with no name of its own.
    // This is what a v0.5 `@connect(selection: "$->Pet")` looks like.
    if (this.peek() === '$' || this.peek() === '@') {
      const readsFrom = this.readValueSource();
      const methods = readsFrom ? this.readMethods() : null;
      if (!readsFrom || !methods || !this.skipFallbacks()) {
        return this.unreadableField(place, start);
      }
      const nested = this.readBlock();
      if (nested === null) {
        return this.unreadableField(place, start);
      }
      return this.field({ isMerge: false, readsFrom, methods, place, nested, start });
    }

    const firstName = this.readAnyName();
    if (!firstName) {
      return this.unreadableField(place, start);
    }
    this.skipBlanks();

    // `category: category->Category` — a name, a colon, then what it reads from
    if (this.peek() === ':') {
      this.at += 1;
      this.skipBlanks();
      const readsFrom = this.readValueSource();
      if (!readsFrom) {
        return this.unreadableField(place, start);
      }
      const methods = this.readMethods();
      if (!methods || !this.skipFallbacks()) {
        return this.unreadableField(place, start);
      }
      const nested = this.readBlock();
      if (nested === null) {
        return this.unreadableField(place, start);
      }
      return this.field({
        outputName: this.toSdl(firstName),
        isMerge: false,
        readsFrom,
        methods,
        place,
        nested,
        start,
      });
    }

    // `id`, `photoUrls->first`, `category { ... }` — the name is also what it reads from
    this.at = firstName.to;
    const readsFrom = this.valueSource('fieldName', this.readPathRest([firstName]), firstName.from);
    const methods = readsFrom ? this.readMethods() : null;
    if (!readsFrom || !methods || !this.skipFallbacks()) {
      return this.unreadableField(place, start);
    }
    const nested = this.readBlock();
    if (nested === null) {
      return this.unreadableField(place, start);
    }
    return this.field({
      outputName: this.toSdl(firstName),
      isMerge: false,
      readsFrom,
      methods,
      place,
      nested,
      start,
    });
  }

  private readValueSource(): ValueSource | null {
    const start = this.at;
    if (this.peek() === '$') {
      this.at += 1;
      // `$(true)` wraps a value written out in full; `$args`/`$this` name one the router supplies.
      // Neither is a key in the response, so there is no path for a check to look up.
      if (this.peek() === '(') {
        if (!this.skipBrackets('(', ')')) {
          return null;
        }
      } else {
        this.readName();
      }
      return this.valueSource('dollar', this.readPathRest([]), start);
    }
    if (this.peek() === '@') {
      this.at += 1;
      return this.valueSource('atSign', this.readPathRest([]), start);
    }
    const head = this.readAnyName();
    if (!head) {
      return null;
    }
    return this.valueSource('fieldName', this.readPathRest([head]), start);
  }

  private valueSource(startsAt: ValueSource['startsAt'], pathParts: NamedSpan[] | null, start: number): ValueSource | null {
    if (!pathParts) {
      return null;
    }
    return {
      startsAt,
      pathParts: pathParts.map((part) => this.toSdl(part)),
      from: this.sdlPosition(start),
      to: this.sdlPosition(this.at),
    };
  }

  // `a ?? b` uses b when a is missing, `a ?! b` when a is null. The fallback is a value in its own
  // right and can be chained, e.g. (digitalocean) `available: available ?? $(true)`.
  // Nothing is checked inside a fallback: it is not read from the response.
  private skipFallbacks(): boolean {
    for (;;) {
      const before = this.at;
      this.skipBlanks();
      if (!this.text.startsWith('??', this.at) && !this.text.startsWith('?!', this.at)) {
        this.at = before;
        return true;
      }
      this.at += 2;
      this.skipBlanks();
      if (!this.readValueSource() || !this.readMethods()) {
        return false;
      }
    }
  }

  // the `.name` steps of `category.name`. A `?` after any step means "carry on if this is missing",
  // e.g. `image?.slug` — it changes nothing about which key is being asked for.
  private readPathRest(parts: NamedSpan[]): NamedSpan[] | null {
    this.skipOptionalMarker();
    while (this.peek() === '.') {
      this.at += 1;
      const part = this.readAnyName();
      if (!part) {
        return null;
      }
      parts.push(part);
      this.skipOptionalMarker();
    }
    return parts;
  }

  // a lone `?`, but not the `??` or `?!` that starts a fallback
  private skipOptionalMarker(): void {
    if (this.peek() === '?' && this.peek(1) !== '?' && this.peek(1) !== '!') {
      this.at += 1;
    }
  }

  // `->first`, or `->map(@->Tag)` with its brackets skipped over rather than read
  private readMethods(): MethodCall[] | null {
    const methods: MethodCall[] = [];
    while (this.text.startsWith('->', this.at)) {
      this.at += 2;
      const name = this.readName();
      if (!name) {
        return null;
      }
      const call: MethodCall = { ...this.toSdl(name), hasBrackets: false };
      if (this.peek() === '(') {
        const bracketsFrom = this.at;
        if (!this.skipBrackets('(', ')')) {
          return null;
        }
        call.hasBrackets = true;
        call.bracketsFrom = this.sdlPosition(bracketsFrom);
        call.bracketsTo = this.sdlPosition(this.at);
      }
      methods.push(call);
    }
    return methods;
  }

  /** The `{ ... }` after a field. `undefined` when there is none, `null` when it never closes. */
  private readBlock(): SelectedField[] | undefined | null {
    const before = this.at;
    this.skipBlanks();
    if (this.peek() !== '{') {
      this.at = before;
      return undefined;
    }
    this.at += 1;
    const nested = this.readFields('nestedBlock');
    this.skipBlanks();
    if (this.peek() !== '}') {
      return null;
    }
    this.at += 1;
    return nested;
  }

  private readAnyName(): NamedSpan | null {
    return this.readQuotedName() ?? this.readName();
  }

  private readName(): NamedSpan | null {
    if (!SelectionReader.NAME_FIRST.test(this.peek())) {
      return null;
    }
    const start = this.at;
    while (!this.done && SelectionReader.NAME_REST.test(this.peek())) {
      this.at += 1;
    }
    return { name: this.text.slice(start, this.at), from: start, to: this.at };
  }

  // a JSON key that is not a GraphQL name has to be quoted, e.g. `photo: "photo-url"`
  private readQuotedName(): NamedSpan | null {
    const quote = this.peek();
    if (quote !== '"' && quote !== "'") {
      return null;
    }
    const start = this.at;
    this.at += 1;
    while (!this.done && this.peek() !== quote) {
      this.at += this.peek() === '\\' ? 2 : 1;
    }
    if (this.done) {
      return null; // never closed
    }
    this.at += 1;
    // the quotes carry escapes the key itself does not have: `$."back\\slash"` names the JSON key
    // `back\slash`. Read them the way the router does — `\n` is a newline, any other `\x` is `x`.
    const raw = this.text.slice(start + 1, this.at - 1);
    const name = raw.replace(/\\(.)/g, (_, escaped: string) => (escaped === 'n' ? '\n' : escaped));
    return { name, from: start, to: this.at };
  }

  /** Skip a bracketed run, minding nesting and quotes. False when it never closes. */
  private skipBrackets(open: string, close: string): boolean {
    if (this.peek() !== open) {
      return false;
    }
    let depth = 0;
    while (!this.done) {
      const character = this.peek();
      if (character === '"' || character === "'") {
        if (!this.readQuotedName()) {
          return false;
        }
        continue;
      }
      if (character === open) {
        depth += 1;
      } else if (character === close) {
        depth -= 1;
        this.at += 1;
        if (depth === 0) {
          return true;
        }
        continue;
      }
      this.at += 1;
    }
    return false;
  }

  // Whitespace, commas, and `#` comments, which the generator writes where it cut a cycle:
  //   # children: circular reference omitted (re-visit schema and remove the reference)
  //   extra { label }
  private skipBlanks(): void {
    for (;;) {
      while (!this.done && /[\s,]/.test(this.peek())) {
        this.at += 1;
      }
      if (this.peek() !== '#') {
        return;
      }
      while (!this.done && this.peek() !== '\n') {
        this.at += 1;
      }
    }
  }

  // give up on this field and pick up again at the next one
  private skipToNextField(): void {
    while (!this.done && !'\n,}'.includes(this.peek())) {
      this.at += 1;
    }
  }

  private unreadableField(place: SelectionPlace, start: number): SelectedField {
    this.skipToNextField();
    return {
      isMerge: false,
      readsFrom: {
        startsAt: 'nothing',
        pathParts: [],
        from: this.sdlPosition(start),
        to: this.sdlPosition(this.at),
      },
      methods: [],
      place,
      from: this.sdlPosition(start),
      to: this.sdlPosition(this.at),
      unreadable: true,
    };
  }

  private field(parts: {
    outputName?: NamedSpan;
    isMerge: boolean;
    readsFrom: ValueSource;
    methods: MethodCall[];
    place: SelectionPlace;
    nested?: SelectedField[];
    start: number;
  }): SelectedField {
    return {
      outputName: parts.outputName,
      isMerge: parts.isMerge,
      readsFrom: parts.readsFrom,
      methods: parts.methods,
      place: parts.place,
      nested: parts.nested,
      from: this.sdlPosition(parts.start),
      to: this.sdlPosition(this.at),
      unreadable: false,
    };
  }

  // Positions come out of the reader counted along the selection text, but everything we hand back
  // is counted along the SDL. Convert at the boundary, or a fix lands on the wrong characters.
  private toSdl(span: NamedSpan): NamedSpan {
    return { name: span.name, from: this.sdlPosition(span.from), to: this.sdlPosition(span.to) };
  }

  private sdlPosition(index: number): number {
    const positions = this.source.sdlPositions;
    return positions[Math.min(index, positions.length - 1)];
  }

  private get text(): string {
    return this.source.text;
  }

  private get done(): boolean {
    return this.at >= this.text.length;
  }

  private peek(ahead = 0): string {
    return this.text[this.at + ahead] ?? '';
  }
}
