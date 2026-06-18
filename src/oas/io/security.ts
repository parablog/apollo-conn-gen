import _ from 'lodash';
import Oas from 'oas';
import { SecurityRequirementObject, SecuritySchemeObject, SecuritySchemesObject } from 'oas/types';
import { OpenAPIV3 } from 'openapi-types';

// A connector name/value entry: a header (`{ name, value }`) or a query param (`"name": value`).
// Also the shape mergeOverrides produces for inferred/overridden header & query params.
export interface NameValue {
  name: string;
  value: string;
}

// One resolved auth credential: a NameValue plus where it goes. Header values carry `{}`
// interpolation (`Bearer {$config.token}`); a query value is a raw JSONSelection (`$config.apiKey`).
export interface AuthEntry extends NameValue {
  kind: 'header' | 'query';
}

// The HTTP methods a path item can hold — reuse the canonical enum rather than a local literal.
const HTTP_METHODS = Object.values(OpenAPIV3.HttpMethods);

/**
 * Map one OAS security scheme to its connector auth entry, or null when it makes none.
 * Shared by the @source writer (slice 1), the per-operation @connect header writer (slice 2),
 * and the per-@connect queryParams writer (slice 3).
 */
export function mapSchemeToAuth(scheme: SecuritySchemeObject): AuthEntry | null {
  switch (scheme.type) {
    case 'apiKey':
      // apiKey carried in a header, e.g. `{ type: apiKey, in: header, name: X-API-Key }`
      if (scheme.in === 'header' && scheme.name) {
        return { kind: 'header', name: scheme.name, value: '{$config.apiKey}' };
      }
      // apiKey carried in the query string, e.g. `{ type: apiKey, in: query, name: api_key }` ->
      // a queryParams JSONSelection (no `{}` braces): `api_key: $config.apiKey`
      if (scheme.in === 'query' && scheme.name) {
        return { kind: 'query', name: scheme.name, value: '$config.apiKey' };
      }
      return null; // cookie is deferred and warned about, not emitted
    case 'http':
      // e.g. `{ type: http, scheme: bearer }`
      if (scheme.scheme === 'bearer') {
        return { kind: 'header', name: 'Authorization', value: 'Bearer {$config.token}' };
      }
      // e.g. `{ type: http, scheme: basic }`
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
    return `[security] scheme "${name}" is referenced by global security but not defined; skipped.`;
  }
  if (scheme.type === 'apiKey' && scheme.in === 'cookie') {
    return `[security] scheme "${name}" is apiKey in cookie — not emitted (cookie auth deferred).`;
  }
  return `[security] scheme "${name}" (${scheme.type}) not emitted — only the first usable scheme of the requirement is mapped.`;
}

/**
 * Resolve a security requirement to the single auth entry the connector should send.
 *
 * A requirement is an OR of scheme-name sets (`[{ a: [] }, { b: [] }]` = "a OR b"). We flatten to
 * names in order and pick the FIRST that maps to an entry (`mapSchemeToAuth`); every other referenced
 * name — undefined, deferred (cookie), or simply not the winner — is reported in `warnings`. An
 * absent (`undefined`) or empty (`[]`, public) requirement yields no entry and no warnings.
 *
 * Callers act on `auth.kind` (`header` → @source / @connect headers; `query` → @connect queryParams)
 * and emit `warnings` with their own context — see `resolveOpAuth` (operationWriter) and
 * `securityHeader` (schemaWriter).
 */
export function resolveAuth(
  securityRequirements: SecurityRequirementObject[] | undefined,
  securitySchemes: SecuritySchemesObject,
): { auth: AuthEntry | null; warnings: string[] } {
  let auth: AuthEntry | null = null;
  const warnings: string[] = [];

  // flatten the OR-of-sets to scheme names in declared order
  for (const name of securityRequirements?.flatMap((requirement) => Object.keys(requirement)) ?? []) {
    const scheme = securitySchemes[name];
    const entry = scheme ? mapSchemeToAuth(scheme) : null;

    // first scheme that maps wins; anything else (no map, or a later alternative) is reported
    if (entry && !auth) {
      auth = entry;
    } else {
      warnings.push(droppedSchemeWarning(name, scheme));
    }
  }

  return { auth, warnings };
}

/** Read `components.securitySchemes` (OAS 3) falling back to `securityDefinitions` (Swagger 2.0). */
export function securitySchemes(api: Oas): SecuritySchemesObject {
  const def = api.getDefinition();
  // oas-normalize usually up-converts Swagger 2.0 → components.securitySchemes; the
  // securityDefinitions fallback (same shape, exposed via OASDocument's index signature) is a
  // safety net. refs are already dereferenced by oas, so the shape is a plain SecuritySchemesObject.
  return (def.components?.securitySchemes ?? def.securityDefinitions ?? {}) as SecuritySchemesObject;
}

/** The spec's global `security` requirement (the document-level default), or undefined. */
export function globalSecurity(api: Oas): SecurityRequirementObject[] | undefined {
  return api.getDefinition().security;
}

/**
 * True when ANY operation in the spec declares its own `security` (empty `[]` or non-empty).
 * This is the per-source mode switch: when true, a shared `@source` auth header is unsafe
 * (a public op would still leak it, and a different-named override would send both), so auth
 * moves to each operation's `@connect` instead. See the ROADMAP R5 slice 2 notes.
 */
export function anyOperationDeclaresSecurity(api: Oas): boolean {
  const paths = api.getDefinition().paths ?? {};

  for (const pathName of Object.keys(paths)) {
    const path = paths[pathName];
    if (!path) continue;

    for (const method of HTTP_METHODS) {
      const op = path[method];
      // own property (not inherited) — an explicit `security: []` is still a declaration
      if (op && _.has(op, 'security')) {
        return true;
      }
    }
  }
  return false;
}
