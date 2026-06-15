import _ from 'lodash';
import Oas from 'oas';
import { SecurityRequirementObject, SecuritySchemeObject, SecuritySchemesObject } from 'oas/types';
import { OpenAPIV3 } from 'openapi-types';

// One auth header: the header name and its value template (e.g. Authorization / "Bearer {$config.token}").
export type AuthHeader = { name: string; value: string };

// The HTTP methods a path item can hold — reuse the canonical enum rather than a local literal.
const HTTP_METHODS = Object.values(OpenAPIV3.HttpMethods);

/**
 * Map one OAS security scheme to its connector header, or null when it makes no header.
 * Shared by the @source writer (slice 1) and the per-operation @connect writer (slice 2).
 */
export function mapSchemeToAuthHeader(scheme: SecuritySchemeObject): AuthHeader | null {
  switch (scheme.type) {
    case 'apiKey':
      // apiKey carried in a header, e.g. `{ type: apiKey, in: header, name: X-API-Key }`
      if (scheme.in === 'header' && scheme.name) {
        return { name: scheme.name, value: '{$config.apiKey}' };
      }
      return null; // query / cookie are deferred and warned about, not emitted as headers
    case 'http':
      // e.g. `{ type: http, scheme: bearer }`
      if (scheme.scheme === 'bearer') {
        return { name: 'Authorization', value: 'Bearer {$config.token}' };
      }
      // e.g. `{ type: http, scheme: basic }`
      if (scheme.scheme === 'basic') {
        return { name: 'Authorization', value: 'Basic {$config.token}' };
      }
      return null;
    case 'oauth2':
    case 'openIdConnect':
      // both flows ultimately send a bearer token
      return { name: 'Authorization', value: 'Bearer {$config.token}' };
    default:
      return null;
  }
}

/** Build a loud warning for a scheme that was not turned into a header. */
export function dropWarning(name: string, scheme: SecuritySchemeObject | undefined): string {
  if (!scheme) {
    return `[security] scheme "${name}" is referenced by global security but not defined; skipped.`;
  }
  if (scheme.type === 'apiKey' && scheme.in === 'query') {
    return `[security] scheme "${name}" is apiKey in query — not emitted as a header (query-param auth deferred).`;
  }
  if (scheme.type === 'apiKey' && scheme.in === 'cookie') {
    return `[security] scheme "${name}" is apiKey in cookie — not emitted as a header (cookie auth deferred).`;
  }
  return `[security] scheme "${name}" (${scheme.type}) not emitted — only the first header-producing scheme of the requirement is mapped.`;
}

/**
 * Resolve a security requirement to a single header, reusing the slice-1 rule: flatten the
 * referenced scheme names and pick the first that produces a header; every other scheme is
 * warned about. An absent (`undefined`) or empty (`[]`, i.e. public) requirement makes no
 * header. The caller decides what a null header means in its context (see the mode switch in
 * schemaWriter / operationWriter) and emits the returned warnings with its own prefix.
 */
export function resolveAuthHeader(
  // e.g. `[{ bearerAuth: [] }]` (one requirement, one scheme) or `[{ a: [] }, { b: [] }]` (OR of schemes)
  securityRequirements: SecurityRequirementObject[] | undefined,
  securitySchemes: SecuritySchemesObject,
): { header: AuthHeader | null; warnings: string[] } {
  // absent or `security: []` (public) → no header, nothing to warn about
  if (!securityRequirements?.length) {
    return { header: null, warnings: [] };
  }

  // flatten to scheme names (across objects = OR, within each = AND), then resolve each to a header
  // (null if it makes none, e.g. apiKey in query)
  const candidates = securityRequirements
    .flatMap((requirement) => Object.keys(requirement))
    .map((name) => {
      const scheme = securitySchemes[name];
      return { name, scheme, header: scheme ? mapSchemeToAuthHeader(scheme) : null };
    });

  // the first scheme that produces a header wins; every other referenced scheme is warned about
  const chosen = candidates.find((candidate) => candidate.header);
  const warnings = candidates
    .filter((candidate) => candidate !== chosen)
    .map((candidate) => dropWarning(candidate.name, candidate.scheme));

  return { header: chosen?.header ?? null, warnings };
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
