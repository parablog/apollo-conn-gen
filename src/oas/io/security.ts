import _ from 'lodash';
import type Oas from 'oas';
import { SecurityRequirementObject, SecuritySchemeObject, SecuritySchemesObject } from 'oas/types';
import type { Op } from '../nodes/internal.js';

// A connector name/value entry: a header (`{ name, value }`) or a query param (`"name": value`).
// Also the shape mergeOverrides produces for inferred/overridden header & query params.
export interface NameValue {
  name: string;
  value: string;
}

// One resolved auth credential: a NameValue plus where it goes. Header values carry `{}`
// interpolation (`Bearer {$config.token}`); a query value is a raw JSONSelection (`$config.apiKey`).
interface AuthEntry extends NameValue {
  kind: 'header' | 'query';
}

// The HTTP methods the generator actually emits (see OasGen.isSupported). Scanning only these for
// the per-op-mode switch keeps the decision consistent with what gets written — a `security` on an
// un-emitted HEAD/OPTIONS op no longer flips the whole spec into per-op mode.
const SUPPORTED_METHODS: readonly string[] = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * Map one OAS security scheme to its connector auth entry, or null when it makes none.
 * Header values carry `{}` interpolation; a query value is a raw JSONSelection (no braces) because
 * it lands in a `queryParams: """…"""` block, which is already a JSONSelection context.
 */
function mapSchemeToAuth(scheme: SecuritySchemeObject): AuthEntry | null {
  switch (scheme.type) {
    case 'apiKey':
      // apiKey in a header, e.g. `{ type: apiKey, in: header, name: X-API-Key }`
      if (scheme.in === 'header' && scheme.name) {
        return { kind: 'header', name: scheme.name, value: '{$config.apiKey}' };
      }
      // apiKey in the query string, e.g. `{ type: apiKey, in: query, name: api_key }`
      if (scheme.in === 'query' && scheme.name) {
        return { kind: 'query', name: scheme.name, value: '$config.apiKey' };
      }
      return null; // cookie is deferred and warned about, not emitted
    case 'http':
      if (scheme.scheme === 'bearer') {
        return { kind: 'header', name: 'Authorization', value: 'Bearer {$config.token}' };
      }
      if (scheme.scheme === 'basic') {
        return { kind: 'header', name: 'Authorization', value: 'Basic {$config.token}' };
      }
      return null;
    case 'oauth2':
    case 'openIdConnect':
      // both flows ultimately send a bearer token
      return { kind: 'header', name: 'Authorization', value: 'Bearer {$config.token}' };
    default:
      return null;
  }
}

/** The warning text for a referenced scheme we did not emit (undefined, deferred, or not the winner). */
function droppedSchemeWarning(name: string, scheme: SecuritySchemeObject | undefined): string {
  if (!scheme) {
    return `[security] scheme "${name}" is referenced but not defined; skipped.`;
  }
  if (scheme.type === 'apiKey' && scheme.in === 'cookie') {
    return `[security] scheme "${name}" is apiKey in cookie — not emitted (cookie auth deferred).`;
  }
  return `[security] scheme "${name}" (${scheme.type}) has no supported connector mapping; skipped.`;
}

/**
 * Resolve a security requirement to the single auth entry the connector should send.
 *
 * A requirement is an OR of scheme-name sets (`[{ a: [] }, { b: [] }]` = "a OR b"). We flatten to
 * names in order and pick the FIRST that maps to an entry. A later viable alternative is a
 * legitimate OR choice, not a failure, so it stays silent; only genuinely unresolvable names —
 * undefined, deferred (cookie), or an unmappable scheme — are reported in `warnings`. An absent or
 * empty (`[]`, public) requirement yields no entry and no warnings.
 */
function resolveAuth(
  securityRequirements: SecurityRequirementObject[] | undefined,
  schemes: SecuritySchemesObject,
): { auth: AuthEntry | null; warnings: string[] } {
  let auth: AuthEntry | null = null;
  const warnings: string[] = [];

  for (const name of securityRequirements?.flatMap((requirement) => Object.keys(requirement)) ?? []) {
    const scheme = schemes[name];
    const entry = scheme ? mapSchemeToAuth(scheme) : null;

    if (entry) {
      // first scheme that maps wins; a later viable alternative is a silent OR choice
      if (!auth) auth = entry;
    } else {
      // genuinely unresolvable: undefined scheme, cookie, or no supported mapping
      warnings.push(droppedSchemeWarning(name, scheme));
    }
  }

  return { auth, warnings };
}

/** True when ANY emitted operation declares its own `security` (empty `[]` or non-empty). */
function hasPerOperationSecurity(def: ReturnType<Oas['getDefinition']>): boolean {
  const paths = def.paths ?? {};
  for (const pathName of Object.keys(paths)) {
    const path = paths[pathName];
    if (!path) continue;
    for (const method of SUPPORTED_METHODS) {
      // own property (not inherited) — an explicit `security: []` is still a declaration
      if (_.has(path, [method, 'security'])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Resolved security for one generation pass: computed once from the parsed spec, then queried for
 * `@source` (sourceHeader) and per-`@connect` (forOp). Owning all auth warnings here removes the old
 * uniform-vs-per-op "who warns when" coordination between SchemaWriter and OperationWriter.
 *
 * Mode switch: when any emitted op declares its own `security`, a shared `@source` header is unsafe
 * (a public op would leak it; a differently-named override would send both), so header auth moves to
 * each `@connect`. Query auth always lives per-`@connect` — `SourceHTTP` has no `queryParams`.
 */
export class SecurityPlan {
  private readonly schemes: SecuritySchemesObject;
  private readonly globalReq: SecurityRequirementObject[] | undefined;
  private readonly perOpMode: boolean;

  private constructor(
    schemes: SecuritySchemesObject,
    globalReq: SecurityRequirementObject[] | undefined,
    perOpMode: boolean,
  ) {
    this.schemes = schemes;
    this.globalReq = globalReq;
    this.perOpMode = perOpMode;
  }

  static from(api: Oas): SecurityPlan {
    const def = api.getDefinition();
    // oas-normalize usually up-converts Swagger 2.0 → components.securitySchemes; the
    // securityDefinitions fallback (same shape) is a safety net. refs are dereferenced by oas,
    // so the shape is a plain SecuritySchemesObject.
    const schemes = (def.components?.securitySchemes ?? def.securityDefinitions ?? {}) as SecuritySchemesObject;
    return new SecurityPlan(schemes, def.security, hasPerOperationSecurity(def));
  }

  /** The `@source`-level auth header literal (uniform mode + header kind), or null. */
  sourceHeader(): string | null {
    // per-op mode: each @connect carries its own auth — nothing on @source
    if (this.perOpMode) return null;
    // no global requirement -> keep the headerless @source byte-for-byte
    if (!this.globalReq || this.globalReq.length === 0) return null;

    const { auth, warnings } = resolveAuth(this.globalReq, this.schemes);
    // surface every dropped scheme loudly, exactly once
    for (const w of warnings) console.warn(w);

    // @source carries only header auth; query auth lives on each @connect (SourceHTTP has no
    // queryParams) and is returned by forOp — emit nothing here.
    if (auth?.kind !== 'header') {
      if (!auth) {
        const names = this.globalReq.flatMap((req) => Object.keys(req));
        console.warn(
          `[security] global security requirement (${names.join(', ')}) maps to no header-producing scheme; no auth header emitted on @source.`,
        );
      }
      return null;
    }

    return `{ name: "${auth.name}", value: "${auth.value}" }`;
  }

  /**
   * This op's resolved auth, split by placement.
   *  - `header`: the header entry in per-op mode (uniform mode puts it on `@source`), else null
   *  - `query`:  the query entry, always (SourceHTTP has no queryParams), else null
   *
   * Per-op warnings are emitted here with op context; in uniform mode the global warnings were
   * already emitted once by sourceHeader.
   */
  forOp(op: Op): { header: NameValue | null; query: NameValue | null } {
    // `??` not `||`: an explicit `security: []` (public) must NOT fall back to the global.
    const effective = op.operation.schema.security ?? this.globalReq;
    const { auth, warnings } = resolveAuth(effective, this.schemes);

    if (this.perOpMode) {
      const where = `${op.verb} ${op.operation.path}`;
      for (const w of warnings) console.warn(`${w} (operation ${where})`);
    }

    return {
      header: this.perOpMode && auth?.kind === 'header' ? auth : null,
      query: auth?.kind === 'query' ? auth : null,
    };
  }
}
