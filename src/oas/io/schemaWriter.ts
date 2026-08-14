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
      writer.write(`  @source(name: "api", http: { baseURL: "${host}", headers: [${authHeader}] })\n\n`);
    } else {
      writer.write('  @source(name: "api", http: { baseURL: "').write(host).write('" })\n\n');
    }
  }
}
