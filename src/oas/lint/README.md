# How the selection linter works

`lintSelections(sdl, gen?)` checks the selections in a connector schema and reports findings with
exact positions in the document. Two consumers drive it: the web editor calls it on every
keystroke, and `tools/lint-corpus.mts` runs it over every generated op as a gate — the generator
should never write a selection its own linter rejects.

## The pipeline

```
SDL text
  → SchemaReader.read          parse + collect what the checks need
      → DirectiveTextReader    pull each selection's text out, keeping positions
      → SelectionReader        read that text into fields
  → checks                     compare what was read against what should be
  → LintDiagnostic[]           { code, severity, message, from, to, fix? }
```

The optional `gen` is the dividing line between the two kinds of checks: document-only checks
always run; checks that need to know what the API really returns only run when a loaded `OasGen`
is passed.

## Stage 1 — `SchemaReader`

Parses the SDL with graphql-js. A document that does not parse is reported as unreadable and every
check stays quiet — the user is mid-keystroke, and half a document must not produce complaints.

From a parsed document it collects two things:

- **types** — name, fields (with the type name unwrapped from `[…]!` and its list depth), and
  whether the type carries `@mapping`. Duplicate definitions of one name are merged rather than
  last-one-wins.
- **selections** — one per `@mapping(selection:)` on a type and per `@connect(selection:)` on a
  field. For a `@connect` it also rebuilds the operation key from the http block
  (`GET: "/pet/{$args.petId}"` → `get:/pet/{petId}`), spelled the way the generator keys its
  `paths` map — that is the bridge back to the spec.

## The position trick — `DirectiveTextReader`

The selection lives inside a GraphQL string argument, and graphql-js normalises `"""` block
strings (strips indentation, resolves escapes) — linting `node.value` would put every underline a
few characters off. So the reader walks the raw SDL characters between the quotes itself, building
`text` plus `sdlPositions[]`: for every character of the selection text, the exact offset it came
from in the user's document. Escapes collapse to one character but remember the position of their
backslash. Everything downstream reports document positions for free.

## Stage 2 — `SelectionReader`

A small hand parser over that text — deliberately not the router's parser and not trying to be.
Per field it answers: what is it called, what does it read from (a field name, a `$`-rooted value,
or `@`), and which `->methods` it calls — plus nested blocks, aliases, quoted keys (unescaped the
way the router reads them), `??`/`?!` fallbacks (skipped: not read from the response) and `?`
optional markers. The first thing it cannot read marks the field unreadable and stops that
selection — a half-typed line never yields a complaint.

## Stage 3 — the checks

- **`ArrowTargetCheck`** (no spec needed): every `->name` must be a router builtin
  (`arrowMethods.ts`, a hardcoded list and the piece most likely to go stale) or a type in this
  document that carries `@mapping`. Two codes: `TARGET_HAS_NO_MAPPING` vs `UNKNOWN_ARROW_TARGET`;
  the unknown case attaches a fix (`->trimStrt` → "Change to `->trimStart`") when a builtin is
  within 2 edits.
- **`PathInResponseCheck`** (spec needed): walks each selection path (`category.name`) step by
  step against the operation's real response schema, via `ResponseShape` — which reuses the
  generator's own `T.responseItemSchema`, so the linter sees the spec through the same eyes as
  the emitter.

`ResponseShape.look` answers one of four things per key: `found`; `notDocumented` (warning — JSON
Schema still allows extra keys); `forbidden` (error — `additionalProperties: false`);
`cannotTell` (free-form, silence from there down). The bias is stated and deliberate: it can miss
a wrong path but will never blame a right one.

The v0.5 branch adds its `@mapping` checks to the same `CHECKS` list (`arrowType`, `bareMapping`,
`mappingCycle`, `receiverIsParent`); the list lives in one place so that merge lands without a
conflict.

## Output

A flat list of `{code, severity, message, from, to, fix?}`, sorted by position; `from`/`to` are
raw SDL offsets, so an editor underlines them directly. The corpus harness inverts the purpose:
any finding fails the run, and its "fields read" counter guards against a linter that passes by
reading nothing.

## Known limits

A second opinion, not an authority: the arrow-method list and the reader's grammar can drift from
the router, and everywhere the linter cannot be sure it says nothing. Its first corpus pass found
one real generator bug (docs/issues.md #63) and one linter bug (#64) — the gate works.
