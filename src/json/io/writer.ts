import { DEFAULT_VERSIONS } from '../../versions.js';
import { JsonGen } from '../walker/jsonGen.js';
import { sanitiseField, upperFirst } from '../walker/naming.js';

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
  rootType?: string;
  baseURL?: string;
  relativePath?: string;
}

export class ConnectorWriter {
  public static write(walker: JsonGen, writer: IWriter, options?: ConnectorWriterOptions): void {
    this.writeConnector(writer, options);
    writer.write(walker.writeTypes());
    this.writeQuery(walker, writer, options);
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
  @source(name: "api", http: { baseURL: "${options?.baseURL || 'http://localhost:4010'}" })
  
`);
  }

  private static parseRootType(raw?: string): { typeName: string; fieldName: string; isList: boolean } {
    if (!raw) return { typeName: 'Root', fieldName: 'root', isList: false };
    const listMatch = raw.match(/^\[(.+)]$/);
    const name = listMatch ? listMatch[1] : raw;
    return {
      typeName: upperFirst(sanitiseField(name)),
      fieldName: sanitiseField(name),
      isList: !!listMatch,
    };
  }

  private static writeQuery(walker: JsonGen, writer: IWriter, options?: ConnectorWriterOptions): void {
    const { typeName, fieldName, isList } = this.parseRootType(options?.rootType);
    const relativePath = options?.relativePath ?? '/test';
    const returnType = isList ? `[${typeName}]` : typeName;

    writer.write(
      '\n' +
        `type Query {
  ${fieldName}: ${returnType}
    @connect(
      source: "api"
      http: { GET: "${relativePath}" }
      selection: """` +
        '\n',
    );

    writer.write(walker.writeSelection());

    const ctx = walker.getContext();

    writer.write(ctx.getIndent() + '"""\n');
    writer.write(ctx.getIndentWith(2) + ')}');
  }
}
