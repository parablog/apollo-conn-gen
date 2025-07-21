import { DEFAULT_VERSIONS } from '../../versions.js';
import { JsonGen } from '../walker/jsonGen.js';

export interface IWriter {
  write(text: string): void;
}

export class StringWriter implements IWriter {
  builder: string[] = [];

  write(text: string): void {
    this.builder.push(text);
  }

  flush(): string {
    return this.builder.join('');
  }

  clear(): void {
    this.builder = [];
  }
}

export interface ConnectorWriterOptions {
  federationVersion?: string;
  connectorSpecVersion?: string;
}

export class ConnectorWriter {
  public static write(walker: JsonGen, writer: IWriter, options?: ConnectorWriterOptions): void {
    this.writeConnector(writer, options);
    writer.write(walker.writeTypes());
    this.writeQuery(walker, writer);
  }

  private static writeConnector(writer: IWriter, options?: ConnectorWriterOptions): void {
    const federationVersion = options?.federationVersion || DEFAULT_VERSIONS.federationVersion;
    const connectorSpecVersion = options?.connectorSpecVersion || DEFAULT_VERSIONS.connectorSpecVersion;
    writer.write(`extend schema
  @link(url: "https://specs.apollo.dev/federation/${federationVersion}", import: ["@key"])
  @link(
    url: "https://specs.apollo.dev/connect/${connectorSpecVersion}"
    import: ["@connect", "@source"]
  )
  @source(name: "api", http: { baseURL: "http://localhost:4010" })
  
`);
  }

  private static writeQuery(walker: JsonGen, writer: IWriter): void {
    writer.write(
      '\n' +
        `type Query {
  root: Root
    @connect(
      source: "api"
      http: { GET: "/test" }
      selection: """` +
        '\n',
    );

    writer.write(walker.writeSelection());

    const ctx = walker.getContext();

    writer.write(ctx.getIndent() + '"""\n');
    writer.write(ctx.getIndentWith(2) + ')}');
  }
}
