import Oas from 'oas';
import { DEFAULT_VERSIONS } from '../../versions.js';
import { OasGen } from '../oasGen.js';
import { Writer } from './writer.js';
import { SecurityPlan } from './security.js';
import { ServerUrl } from '../utils/serverUrl.js';

export class SchemaWriter {
  constructor(
    private gen: OasGen,
    private security: SecurityPlan,
  ) {}

  public writeJSONScalar(writer: Writer): void {
    writer.write('\nscalar JSON\n\n');
  }

  public writeDirectives(writer: Writer): void {
    const api: Oas = this.gen.parser;
    // an explicit baseURL wins; otherwise pick a usable server. see docs/FIXED.md #41
    const host = this.gen.options.baseURL ?? ServerUrl.resolve(api.getDefinition().servers);
    const federationVersion = this.gen.options.federationVersion || DEFAULT_VERSIONS.federationVersion;
    const connectorSpecVersion = this.gen.options.connectorSpecVersion || DEFAULT_VERSIONS.connectorSpecVersion;
    const authHeader = this.security.sourceHeader();
    writer
      .write('extend schema\n')
      .write(`  @link(url: "https://specs.apollo.dev/federation/${federationVersion}", import: ["@key"])\n`)
      .write('  @link(\n')
      .write(`    url: "https://specs.apollo.dev/connect/${connectorSpecVersion}"\n`)
      .write('    import: ["@connect", "@source"]\n')
      .write('  )\n');

    if (authHeader) {
      writer.write(`  @source(name: "api", http: { baseURL: "${host}", headers: [${authHeader}] }`);
    } else {
      writer.write('  @source(name: "api", http: { baseURL: "').write(host).write('" }');
    }

    this.writeSourceErrorMapping(writer);
    writer.write(')\n\n');
  }

  // Writes isSuccess and errors onto @source from the "$source" settings, so the router turns a
  // failed body into a GraphQL error. Writes nothing when neither is set.
  //   e.g. Ashby: { success: false, errors: [{ message: "Not found" }] } -> isSuccess: "$.success"
  private writeSourceErrorMapping(writer: Writer): void {
    const source = this.gen.options.overrides?.['$source'];
    if (!source?.isSuccess && !source?.errors) {
      return;
    }

    if (source.isSuccess) {
      writer.write(`\n    isSuccess: ${SchemaWriter.quotedString(source.isSuccess)}`);
    }
    if (source.errors?.message || source.errors?.extensions) {
      writer.write('\n    errors: {');
      if (source.errors.message) {
        writer.write(` message: ${SchemaWriter.quotedString(source.errors.message)}`);
      }
      if (source.errors.extensions) {
        writer.write(` extensions: ${SchemaWriter.quotedOrBlockString(source.errors.extensions)}`);
      }
      writer.write(' }');
    }
  }

  // Wraps a value in double quotes, escaping any backslash or double quote inside it.
  private static quotedString(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  // A """block string""" when the value spans lines, e.g. two extensions keys, else quoted.
  private static quotedOrBlockString(value: string): string {
    return value.includes('\n') ? `"""\n${value}\n"""` : SchemaWriter.quotedString(value);
  }
}
