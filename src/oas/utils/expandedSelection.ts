import type { IType } from '../nodes/internal.js';
import { Naming } from './naming.js';

// Receives the leaves collectLeafPaths finds, and answers whether a side already has a leaf, the
// check its empty-side fallback makes. The selection marks nodes; the saved-path recovery keeps strings.
// `ancestors` is the walk's chain from the op; a walk starts with beginWalk().
//   e.g. (asana) data: $ref EmptyResponse is taken as a leaf only when hasLeafUnder(res:r) is false
export interface LeafTarget {
  beginWalk(): void;
  add(leaf: IType, ancestors: IType[]): void;
  addForOp(opId: string, leaf: IType, ancestors: IType[]): void;
  exclude(opId: string, node: IType): void;
  markIfWalked(opId: string, child: IType, ancestors: IType[]): void;
  hasLeafUnder(side: IType): boolean;
}

// Holds a node the leaf walk reached, in walk order, with the chain from its op to its parent: a
// leaf, or a node the walk skipped because it passed it already and a leaf lies below it. #242
//   e.g. (1password-connect.json) FullItem's part Item, skipped under a second route of one op
export interface ReachedNode {
  node: IType;
  chain: IType[];
  leaf: boolean;
}

// Holds a selection after its `>**` roots are walked: each root stays one entry, and the nodes on
// the way to a selected leaf are kept instead of one path string per leaf (1,289,302 strings on
// meta-ads' post:/act_{ad_account_id}/ads). A node under a root is selected only when a leaf lies below it:
//   e.g. (quickbooks-online.yaml) BillCreateObject.CurrencyRef, an empty input object under
//   post:/v3/company/{realm-id}/bill>**, is not selected, since no leaf lies below it.
export class ExpandedSelection implements LeafTarget {
  public readonly nodesWithLeaves = new Set<IType>();
  // Lists the leaves and the skipped nodes with a leaf below them, in walk order: the types to write
  // are queued from this, in this order
  public readonly reached: ReachedNode[] = [];
  // What one op's walk leaves out (a field its overrides file reads through isSuccess or errors,
  // and what lies below it) and what only one op's walk marks (the empty-side fallback): a node is
  // shared by every op, so these are kept per op id. see docs/FIXED.md #32 #232 #242
  //   e.g. (shared-envelope.yaml) /x with payload results leaves out success; /y selects it
  public readonly excludedByOp = new Map<string, Set<IType>>();
  public readonly markedByOp = new Map<string, Set<IType>>();
  // Records the route each written type is written from: its fields are the ones selected there. #242
  //   e.g. (1password-connect.json) FullItem -> post:/vaults/{vaultUuid}/items>res:r>comp:type:#/c/s/FullItem
  private readonly writtenPaths = new Map<IType, string>();
  private readonly markedThisWalk = new Set<IType>();
  private prefixesBuiltFrom?: string[];
  private prefixes = new Set<string>();
  private wildcardRoots = new Map<string, string[]>();

  // Takes the resolved `>**` roots, then the explicit entries. An empty one selects nothing.
  //   e.g. ['get:/nodes>**', 'get:/pets>res:r>obj:type:#/c/s/Pet>prop:scalar:id']
  constructor(public entries: string[]) {}

  // True when an entry starts with `path`, or when `path` lies under one of its op's `>**` roots and
  // `node` lies on the way to a leaf that op may select: one op's walk never selects a shared
  // type's fields for another op's explicit entry. see docs/FIXED.md #242
  //   e.g. (shared-component-two-ops.yaml) /a>** selects Item.name; /b's entry for id alone does not
  public isSelected(node: IType, path: string): boolean {
    if (this.entryPrefixes().has(path)) {
      return true;
    }
    const opId = this.findWildcardOp(path);
    if (opId === undefined || this.excludedByOp.get(opId)?.has(node)) {
      return false;
    }
    return this.nodesWithLeaves.has(node) || this.markedByOp.get(opId)?.has(node) === true;
  }

  // Starts a walk: marking stops at a node this walk marked, not one an earlier walk marked.
  //   e.g. /a returns Shared, /b returns Wrapper { child: Shared }: /b marks up to its own root
  public beginWalk(): void {
    this.markedThisWalk.clear();
  }

  // Keeps the leaf with its chain and marks it and its walk ancestors, nearest first.
  //   e.g. (cycles-by-route.yaml) Node.id marks Node, res:r and get:/nodes; Node.parent stops at Node
  public add(leaf: IType, ancestors: IType[]): void {
    this.keepLeaf(leaf, ancestors);
    this.mark(leaf, ancestors);
  }

  // Keeps a leaf only one op selects, marked for that op alone. see docs/FIXED.md #32 #51
  //   e.g. (asana) data: $ref EmptyResponse's fields, taken because the side found no leaf
  public addForOp(opId: string, leaf: IType, ancestors: IType[]): void {
    this.keepLeaf(leaf, ancestors);
    this.mark(leaf, ancestors, this.findOpSet(this.markedByOp, opId));
  }

  // Leaves `node` out of one op's selection. see docs/FIXED.md #232
  //   e.g. (ashby) application.list: errors is left out when the overrides file reads it
  public exclude(opId: string, node: IType): void {
    this.findOpSet(this.excludedByOp, opId).add(node);
  }

  // Marks `node` and its walk ancestors, nearest first, up to the first node this walk marked.
  //   e.g. (composed-loops.yaml) c: C, C: allOf [$ref A, $ref B] -> C and c, once A and B were walked
  public mark(node: IType, ancestors: IType[], into: Set<IType> = this.nodesWithLeaves): void {
    for (let i = ancestors.length; i >= 0; i--) {
      const marked = i === ancestors.length ? node : ancestors[i];
      if (this.markedThisWalk.has(marked)) {
        return;
      }
      this.markedThisWalk.add(marked);
      into.add(marked);
    }
  }

  // Marks the walk's chain down to `child`'s parent when the walk skips `child` because it passed it
  // already and a leaf lies below it, whichever walk found that leaf; an edge of any kind counts. #242
  //   e.g. (composed-loops.yaml) c: C, C: allOf [$ref A, $ref B], A and B walked under a and b -> C, c
  public markIfWalked(opId: string, child: IType, ancestors: IType[]): void {
    const parent = ancestors[ancestors.length - 1];
    if (!parent || this.excludedByOp.get(opId)?.has(child)) {
      return;
    }
    if (this.nodesWithLeaves.has(child)) {
      this.mark(parent, ancestors.slice(0, -1));
    } else if (this.markedByOp.get(opId)?.has(child)) {
      this.mark(parent, ancestors.slice(0, -1), this.findOpSet(this.markedByOp, opId));
    } else {
      return;
    }
    this.reached.push({ node: child, chain: [...ancestors], leaf: false });
  }

  // True when `node` lies on the way to a leaf `opId` selects.
  //   e.g. (shared-envelope.yaml) Detail under /x's results, walked first under /x's errors
  public isMarkedOn(opId: string, node: IType): boolean {
    if (this.excludedByOp.get(opId)?.has(node)) {
      return false;
    }
    return this.nodesWithLeaves.has(node) || this.markedByOp.get(opId)?.has(node) === true;
  }

  // True when a marked child of the node above `side` has an id starting with the side's id, the
  // answer the leaf strings gave: a leaf under `ab` counts for a side `a`. see docs/TASKS.md #245
  //   e.g. (cycles-by-route.yaml) side res:r of get:/nodes, marked once the walk reaches Node.id
  public hasLeafUnder(side: IType): boolean {
    const sideId = Naming.abbreviateRef(side.id);
    const opId = side.parent!.id;
    return side.parent!.children.some(
      (sibling) => this.isMarkedOn(opId, sibling) && Naming.abbreviateRef(sibling.id).startsWith(sideId),
    );
  }

  // Returns the route `node` is written from, or its own path when no route was recorded (a caller
  // with no selection walk behind it).
  //   e.g. (1password-connect.json) FullItem -> the route of the op queued first
  public writtenPath(node: IType): string {
    return this.writtenPaths.get(node) ?? node.path();
  }

  // Records the route `node` is written from, when none is recorded yet: the first route queued. #242
  //   e.g. (shared-component-two-ops.yaml) Item under /a, entered before /b's
  public keepWrittenPath(node: IType, path: string): void {
    if (!this.writtenPaths.has(node)) {
      this.writtenPaths.set(node, path);
    }
  }

  // Replaces the route `node` is written from; true when it changed.
  //   e.g. (shared-component-two-ops.yaml) Envelope takes /g's route once /e's never reaches it
  public replaceWrittenPath(node: IType, path: string): boolean {
    if (this.writtenPaths.get(node) === path) {
      return false;
    }
    this.writtenPaths.set(node, path);
    return true;
  }

  // True when a route was recorded for `node`.
  public hasWrittenPath(node: IType): boolean {
    return this.writtenPaths.has(node);
  }

  // Returns the op whose `>**` root lies above `path`, or undefined when none does.
  //   e.g. get:/nodes>res:r>obj:type:#/c/s/Node under the entry get:/nodes>** -> get:/nodes
  public findWildcardOp(path: string): string | undefined {
    this.entryPrefixes();
    const opId = path.split(Naming.PATH_SEPARATOR, 1)[0];
    const roots = this.wildcardRoots.get(opId);
    return roots?.some((root) => path === root || path.startsWith(root + Naming.PATH_SEPARATOR)) ? opId : undefined;
  }

  private keepLeaf(leaf: IType, ancestors: IType[]): void {
    this.reached.push({ node: leaf, chain: [...ancestors], leaf: true });
  }

  private findOpSet(sets: Map<string, Set<IType>>, opId: string): Set<IType> {
    let set = sets.get(opId);
    if (!set) {
      set = new Set();
      sets.set(opId, set);
    }
    return set;
  }

  // Builds the prefix set of `entries`, and each op's `>**` roots, once per array: a later push to
  // the same array is not seen, the same rule the old per-array cache kept. see docs/TASKS.md #245
  //   e.g. (cycles-by-route.yaml) get:/nodes>res:r>** -> get:/nodes, get:/nodes>res:r, get:/nodes>res:r>**
  private entryPrefixes(): Set<string> {
    if (this.prefixesBuiltFrom === this.entries) {
      return this.prefixes;
    }
    this.prefixes = new Set<string>();
    this.wildcardRoots = new Map<string, string[]>();
    for (const entry of this.entries) {
      this.prefixes.add(entry);
      for (let i = entry.indexOf(Naming.PATH_SEPARATOR); i !== -1; i = entry.indexOf(Naming.PATH_SEPARATOR, i + 1)) {
        this.prefixes.add(entry.slice(0, i));
      }
      if (entry.endsWith('>**')) {
        const root = entry.slice(0, -'>**'.length);
        const opId = root.split(Naming.PATH_SEPARATOR, 1)[0];
        this.wildcardRoots.set(opId, [...(this.wildcardRoots.get(opId) ?? []), root]);
      }
    }
    this.prefixesBuiltFrom = this.entries;
    return this.prefixes;
  }
}
