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

export class ConnectorWriter {
  public static write(walker: JsonGen, writer: IWriter): void {
    this.writeConnector(writer);
    writer.write(walker.writeTypes());
    this.writeQuery(walker, writer);
  }

  private static writeConnector(writer: IWriter): void {
    writer.write(`extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key"])
  @link(
    url: "https://specs.apollo.dev/connect/v0.1"
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
    writer.write(`"""
)}
`);
  }
}
