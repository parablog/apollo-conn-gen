import { Prop, ReferenceObject } from './internal.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { SchemaObject } from 'oas/types';
import { ExpandedSelection } from '../utils/expandedSelection.js';

export type Kind = 'input' | 'type';

// Holds one item of the queue a walk over dependencies() works through: a node and the path of the
// route that reached it. Each child is queued as { node: child, path: parent's path + child's id }
// (Type.childPath), so a type reached on two routes is queued twice, once per route.
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
//   Space's fields are checked against the selection at A for the first item and at B for the second:
//   a selection of B>prop:obj:homepage>… keeps homepage on the second route only. The node alone can't
//   tell them apart once #242 step 3 builds Space once and both items hold the same node.
export interface QueuedNode {
  node: IType;
  path: string;
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
  // The schema this node was built from, when it has one (Obj/Composed/Map and all Props; Ref holds a
  // ReferenceObject). Used for cycle detection by object identity along the ancestor chain. see FIXED.md #10
  schema?: SchemaObject | ReferenceObject | null;

  forPrompt(context: OasContext): string;

  add(child: IType): IType;

  ancestors(): IType[];

  visit(context: OasContext): void;

  generate(context: OasContext, writer: Writer, selection: ExpandedSelection): void;

  pathToRoot(): string;

  path(): string;

  expand(context: OasContext): IType[];

  find(path: string, collection: IType[]): IType | boolean;

  select(context: OasContext, writer: Writer, selection: ExpandedSelection, path: string): void;

  dependencies(context: OasContext, selection: ExpandedSelection, path: string): IType[];

  propPath(prop: Prop, path: string, pathsToMembers?: Map<IType, string[]>): string;

  childPath(context: OasContext, child: IType, path: string): string;

  // What follows the field name in the selection, e.g. (ashby) `->echo({ raw: @ })` for a mixed
  // value; undefined when the bare name is enough.
  selectionSuffix(context: OasContext): string | undefined;
}
