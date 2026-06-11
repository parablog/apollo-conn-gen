import Oas from 'oas';
import { ServerObject } from 'oas/types';
import { DEFAULT_VERSIONS } from '../../versions.js';
import { OasGen } from '../oasGen.js';
import { Writer } from './writer.js';

export class SchemaWriter {
  constructor(private gen: OasGen) {}

  public writeJSONScalar(writer: Writer): void {
    writer.write('\nscalar JSON\n\n');
  }

  public writeDirectives(writer: Writer): void {
    const api: Oas = this.gen.parser;
    const host = this.getServerUrl(api.getDefinition().servers?.[0]);
    const federationVersion = this.gen.options.federationVersion || DEFAULT_VERSIONS.federationVersion;
    const connectorSpecVersion = this.gen.options.connectorSpecVersion || DEFAULT_VERSIONS.connectorSpecVersion;
    const authHeader = this.securityHeader(api);
    // R10: @mapping joins the connect import only in reusable-mappings mode; the federation
    // import stays ["@key"] (no @shareable — deliberate, revisit only if composition demands it).
    const connectImports = this.gen.options.reusableMappings
      ? '["@connect", "@source", "@mapping"]'
      : '["@connect", "@source"]';
    writer
      .write('extend schema\n')
      .write(`  @link(url: "https://specs.apollo.dev/federation/${federationVersion}", import: ["@key"])\n`)
      .write('  @link(\n')
      .write(`    url: "https://specs.apollo.dev/connect/${connectorSpecVersion}"\n`)
      .write(`    import: ${connectImports}\n`)
      .write('  )\n');

    if (authHeader) {
      writer.write(`  @source(name: "api", http: { baseURL: "${host}", headers: [${authHeader}] })\n\n`);
    } else {
      writer.write('  @source(name: "api", http: { baseURL: "').write(host).write('" })\n\n');
    }
  }

  /**
   * R5 (slice 1): derive an `@source`-level auth header from the spec's *global*
   * security requirement. Returns the header literal (e.g.
   * `{ name: "Authorization", value: "Bearer {$config.token}" }`) or null when no
   * header should be emitted. Everything deferred is warned about, never silently dropped.
   */
  private securityHeader(api: Oas): string | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const def = api.getDefinition() as any;
    const global = def.security as Array<Record<string, string[]>> | undefined;
    // OAS3 components.securitySchemes, falling back to Swagger 2.0 securityDefinitions
    // (oas-normalize usually up-converts, but keep the fallback for safety).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schemes = (def.components?.securitySchemes ?? def.securityDefinitions ?? {}) as Record<string, any>;

    // Concern-2 guard: a per-operation `security` (including anonymous `security: []`)
    // *replaces* the global requirement, so the requirement is not uniform across
    // endpoints. A shared @source header would wrongly attach auth to overriding
    // endpoints — emit nothing and warn per affected operation. Checked before the
    // global guard so per-op-only specs (e.g. petstore) still warn loudly.
    const overriding = this.operationsWithSecurity(api);
    if (overriding.length > 0) {
      for (const op of overriding) {
        console.warn(
          `[security] operation ${op} declares its own \`security\`; not emitting a global @source auth header (per-operation auth deferred to a future slice).`,
        );
      }
      return null;
    }

    // No global requirement → keep the current headerless @source byte-for-byte.
    if (!global || global.length === 0) {
      return null;
    }

    // Flatten the global requirement to referenced scheme names, in order: across
    // requirement objects (logical OR) and within each object (logical AND).
    const names: string[] = [];
    for (const req of global) {
      for (const name of Object.keys(req)) {
        names.push(name);
      }
    }

    // Pick the first scheme that maps to a header; warn about every other scheme.
    let header: string | null = null;
    for (const name of names) {
      const scheme = schemes[name];
      const mapped = scheme ? this.mapScheme(scheme) : null;
      if (mapped && !header) {
        header = mapped;
      } else {
        console.warn(this.dropWarning(name, scheme));
      }
    }

    if (!header) {
      console.warn(
        `[security] global security requirement (${names.join(', ')}) maps to no header-producing scheme; no auth header emitted on @source.`,
      );
      return null;
    }

    return header;
  }

  /** Map a single security scheme to its `@source` header literal, or null when it produces no header. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapScheme(scheme: any): string | null {
    switch (scheme.type) {
      case 'apiKey':
        if (scheme.in === 'header' && scheme.name) {
          return `{ name: "${scheme.name}", value: "{$config.apiKey}" }`;
        }
        return null; // query / cookie handled via warnings
      case 'http':
        if (scheme.scheme === 'bearer') {
          return `{ name: "Authorization", value: "Bearer {$config.token}" }`;
        }
        if (scheme.scheme === 'basic') {
          return `{ name: "Authorization", value: "Basic {$config.token}" }`;
        }
        return null;
      case 'oauth2':
      case 'openIdConnect':
        return `{ name: "Authorization", value: "Bearer {$config.token}" }`;
      default:
        return null;
    }
  }

  /** Build a loud warning for a scheme that was not emitted on `@source`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dropWarning(name: string, scheme: any): string {
    if (!scheme) {
      return `[security] scheme "${name}" is referenced by global security but not defined; skipped.`;
    }
    if (scheme.type === 'apiKey' && scheme.in === 'query') {
      return `[security] scheme "${name}" is apiKey in query — not emitted as a header (query-param auth deferred).`;
    }
    if (scheme.type === 'apiKey' && scheme.in === 'cookie') {
      return `[security] scheme "${name}" is apiKey in cookie — not emitted as a header (cookie auth deferred).`;
    }
    return `[security] scheme "${name}" (${scheme.type}) not emitted — only the first header-producing scheme of the global requirement is mapped on @source.`;
  }

  /** Returns "METHOD /path" for every operation that declares its own `security` (including `security: []`). */
  private operationsWithSecurity(api: Oas): string[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paths = (api.getDefinition() as any).paths ?? {};
    const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
    const result: string[] = [];
    for (const p of Object.keys(paths)) {
      const item = paths[p];
      if (!item) continue;
      for (const m of methods) {
        const op = item[m];
        if (op && Object.prototype.hasOwnProperty.call(op, 'security')) {
          result.push(`${m.toUpperCase()} ${p}`);
        }
      }
    }
    return result;
  }

  private getServerUrl(server: ServerObject | undefined): string {
    if (!server) {
      return 'http://localhost:4010';
    }
    let url: string = server.url;
    if (server.variables) {
      for (const key in server.variables) {
        url = url.replace('{' + key + '}', server.variables[key].default);
      }
    }
    return url;
  }
}
