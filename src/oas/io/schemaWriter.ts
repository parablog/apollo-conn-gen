import Oas from 'oas';
import { ServerObject } from 'oas/types';
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
    writer
      .write('extend schema\n')
      .write('  @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key"])\n')
      .write('  @link(\n')
      .write('    url: "https://specs.apollo.dev/connect/v0.1"\n')
      .write('    import: ["@connect", "@source"]\n')
      .write('  )\n')
      .write('  @source(name: "api", http: { baseURL: "')
      .write(host)
      .write('" })\n\n');
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
