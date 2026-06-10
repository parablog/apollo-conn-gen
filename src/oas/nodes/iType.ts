import { Prop, ReferenceObject } from './internal.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { SchemaObject } from 'oas/types';

export type Kind = 'input' | 'type';

export interface IType {
  name: string;
  parent?: IType;
  children: IType[];
  circularRef?: IType;
  props: Map<string, Prop>;
  id: string;
  kind: Kind;
  visited: boolean;
  // The schema this node was built from, when it has one (Obj/Composed/Map and all Props; Ref holds a
  // ReferenceObject). Used for cycle detection by object identity along the ancestor chain. see issues.md #10
  schema?: SchemaObject | ReferenceObject | null;

  forPrompt(context: OasContext): string;

  add(child: IType): IType;

  ancestors(): IType[];

  visit(context: OasContext): void;

  generate(context: OasContext, writer: Writer, selection: string[]): void;

  pathToRoot(): string;

  path(): string;

  expand(context: OasContext): IType[];

  find(path: string, collection: IType[]): IType | boolean;

  select(context: OasContext, writer: Writer, selection: string[]): void;
}
