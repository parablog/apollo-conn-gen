import { Prop } from './prop.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';

export type Kind = "input" | "type";

export interface IType {
  name: string;
  parent?: IType;
  children: IType[];
  circularRef?: IType;
  props: Map<string, Prop>;
  id: string;
  kind: Kind;
  visited: boolean;

  forPrompt(context: OasContext): string;

  add(child: IType): void;

  ancestors(): IType[];

  visit(context: OasContext): void;

  generate(context: OasContext, writer: Writer, selection: string[]): void;

  pathToRoot(): string;

  path(): string;

  expand(context: OasContext): IType[];

  find(path: string, collection: IType[]): IType | boolean;

  select(context: OasContext, writer: Writer, selection: string[]): void;
}
