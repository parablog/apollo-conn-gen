import Oas from 'oas';
import { ServerObject } from 'oas/types';
import { DEFAULT_VERSIONS } from '../../versions.js';
import { OasGen } from '../oasGen.js';
import { Writer } from './writer.js';
import { anyOperationDeclaresSecurity, globalSecurity, securitySchemes, resolveAuthHeader } from './security.js';

export class SchemaWriter {
  constructor(private gen: OasGen) {}

  public writeJSONScalar(writer: Writer): void {
    writer.write('\nscalar JSON\n\n');
  }

  public writeDirectives(writer: Writer): void {
    const api: Oas = this.gen.parser;
    // a spec's servers[0] can be stale or wrong (petstore) — an explicit baseURL wins
    const host = this.gen.options.baseURL ?? this.getServerUrl(api.getDefinition().servers?.[0]);
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
   * R5: derive an `@source`-level auth header from the spec's *global* security requirement.
   * Returns the header literal (e.g. `{ name: "Authorization", value: "Bearer {$config.token}" }`)
   * or null when no header should be emitted on `@source`.
   *
   * Mode switch (slice 2): if any operation declares its own `security`, auth moves to each
   * operation's `@connect` (see operationWriter) and nothing is emitted here — a shared `@source`
   * header is unsafe then (a public op would still send it; a different-named override would send
   * both). Otherwise (uniform mode, slice 1) the global requirement is emitted once on `@source`.
   */
  private securityHeader(api: Oas): string | null {
    // per-op mode: some operation overrides the global → let each @connect carry its own auth
    if (anyOperationDeclaresSecurity(api)) {
      return null;
    }

    // read the document-level (global) security requirement
    const global = globalSecurity(api);
    // no global requirement → keep the headerless @source byte-for-byte
    if (!global || global.length === 0) {
      return null;
    }

    // read the scheme definitions (apiKey/http/oauth2/...) the requirement refers to
    const schemes = securitySchemes(api);
    // resolve the global requirement to one header, collecting per-scheme drop warnings
    const { header, warnings } = resolveAuthHeader(global, schemes);
    // surface every dropped scheme loudly (never silently)
    for (const w of warnings) {
      console.warn(w);
    }

    if (!header) {
      // flatten the referenced scheme names for the summary message
      const names = global.flatMap((req) => Object.keys(req));
      console.warn(
        `[security] global security requirement (${names.join(', ')}) maps to no header-producing scheme; no auth header emitted on @source.`,
      );
      return null;
    }

    // format the resolved header into the @source literal
    return `{ name: "${header.name}", value: "${header.value}" }`;
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
