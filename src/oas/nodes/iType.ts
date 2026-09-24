import { Prop, ReferenceObject } from './internal.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { SchemaObject } from 'oas/types';
import { ExpandedSelection } from '../utils/expandedSelection.js';

export type Kind = 'input' | 'type';

// Holds one item of the queue a walk over dependencies() works through: a node and the path of the
// route that reached it; a type reached on two routes is queued twice, once per route.
//   e.g. (cycle-on-some-routes.yaml) the walk from get:/graph, and the item queued for each Space:
//   get:/graph
//    └─ res:r
//        └─ obj:type:#/c/s/Graph
//            └─ prop:obj:relation
//                └─ obj:type:#/c/s/Relation
//                    ├─ prop:obj:source
//                    │   └─ obj:type:#/c/s/Content
//                    │       └─ prop:obj:space
//                    │           └─ obj:type:#/c/s/Space   -> { node: Space, path: A }
//                    └─ prop:obj:viewer
//                        └─ obj:type:#/c/s/User
//                            └─ prop:obj:personalSpace
//                                └─ obj:type:#/c/s/Space   -> { node: Space, path: B }
//   A = get:/graph>res:r>obj:type:#/c/s/Graph>prop:obj:relation>obj:type:#/c/s/Relation>prop:obj:source
//       >obj:type:#/c/s/Content>prop:obj:space>obj:type:#/c/s/Space
//   B = get:/graph>res:r>obj:type:#/c/s/Graph>prop:obj:relation>obj:type:#/c/s/Relation>prop:obj:viewer
//       >obj:type:#/c/s/User>prop:obj:personalSpace>obj:type:#/c/s/Space
//   Space is built once, so only the path tells the two items apart: a selection of
//   B>prop:obj:homepage>… keeps homepage on the second route only. #242
export interface QueuedNode {
  node: IType;
  path: string;
}

// One way from a node to a member whose fields it reads (an allOf part, a union member, a member of
// either), passing no field: the member, the ids on the way (the member's own last), and the nodes
// on the way (the start first). A member reached twice has two routes.
//   e.g. (shared-allof-members.yaml) D: allOf [$ref A, $ref E], E: allOf [$ref A, …] -> A, E, E>A
export interface MemberRoute {
  member: IType;
  ids: string[];
  passed: IType[];
}

// Holds a field a node writes, the selection path of the occurrence that selected it, and, once the
// writing type numbered its twins, the name it is written under there.
//   e.g. (simple-allOf-example.yaml) User's city at …>comp:type:#/c/s/User>obj:type:#/c/s/Address>prop:scalar:city
export interface SelectedField {
  prop: Prop;
  path: string;
  name?: string;
}

export interface IType {
  name: string;
  parent?: IType;
  children: IType[];
  circularRef?: IType;
  props: Map<string, Prop>;
  id: string;
  kind: Kind;
  visited: boolean;
  // Holds the schema this node was built from, when it has one (Obj/Composed/Map and all Props),
  // compared by object identity to find a list that holds itself on the build path. see FIXED.md #10 #242
  schema?: SchemaObject | ReferenceObject | null;

  forPrompt(context: OasContext): string;

  add(child: IType): IType;

  ancestors(): IType[];

  visit(context: OasContext): void;

  // `fieldName` is the name a field is written under in the type writing it: its own twin number
  // there, since one field can be folded into two types. e.g. (confluence) LookAndFeel.links
  generate(context: OasContext, writer: Writer, selection: ExpandedSelection, fieldName?: string): void;

  pathToRoot(): string;

  path(): string;

  expand(context: OasContext): IType[];

  find(path: string, collection: IType[]): IType | boolean;

  select(context: OasContext, writer: Writer, selection: ExpandedSelection, path: string, fieldName?: string): void;

  dependencies(context: OasContext, selection: ExpandedSelection, path: string): IType[];

  findDependencies(context: OasContext, selection: ExpandedSelection, path: string): QueuedNode[];

  findMemberRoutes(): MemberRoute[];

  findSelectedFields(selection: ExpandedSelection, path: string, routes?: MemberRoute[]): SelectedField[];

  emittedProp(context: OasContext, prop: Prop): Prop;

  findFieldName(prop: Prop, keep: boolean): string;

  numberFieldNames(fields: SelectedField[], keep: boolean): void;

  propPath(prop: Prop, path: string, routes?: MemberRoute[]): string;

  childPath(context: OasContext, child: IType, path: string): string;

  // What follows the field name in the selection, e.g. (ashby) `->echo({ raw: @ })` for a mixed
  // value; undefined when the bare name is enough.
  selectionSuffix(context: OasContext): string | undefined;
}
