import type { IType } from '../nodes/internal.js';
import { Naming } from './naming.js';

// Receives the leaves collectLeafPaths finds, and answers whether a side already has a leaf, the
// check its empty-side fallback makes. The selection marks nodes; the saved-path recovery keeps strings.
//   e.g. (asana) data: $ref EmptyResponse is taken as a leaf only when hasLeafUnder(res:r) is false
export interface LeafTarget {
  add(leaf: IType, ancestors: IType[]): void;
  hasLeafUnder(side: IType): boolean;
}

// Holds a selection after its `>**` roots are walked: each root stays one entry, and the nodes on
// the way to a selected leaf are kept instead of one path string per leaf (1,289,302 strings on
// meta-ads' post:/act_{ad_account_id}/ads). A node under a root is selected only when a leaf lies below it:
//   e.g. (quickbooks-online.yaml) BillCreateObject.CurrencyRef, an empty input object under
//   post:/v3/company/{realm-id}/bill>**, is not selected, since no leaf lies below it.
export class ExpandedSelection implements LeafTarget {
  public readonly nodesWithLeaves = new Set<IType>();
  public readonly leaves = new Set<IType>();
  private prefixesBuiltFrom?: string[];
  private prefixes = new Set<string>();

  // Takes the resolved `>**` roots, then the explicit entries. An empty one selects nothing for
  // generate and select, and every field for Composed.consolidate.
  //   e.g. (cli oas-helpers) `(type as Composed).consolidate(new ExpandedSelection([]))`
  constructor(public entries: string[]) {}

  // True when an entry starts with `path`, or when `node` lies on the way to a selected leaf.
  public isSelected(node: IType, path: string): boolean {
    return this.entryPrefixes().has(path) || this.nodesWithLeaves.has(node);
  }

  // Keeps the leaf and marks it and its walk ancestors, nearest first, up to the first node an
  // earlier leaf already marked (that leaf marked the rest of the chain).
  //   e.g. (cycles-by-route.yaml) Node.id marks Node, res:r and get:/nodes; Node.parent stops at Node
  public add(leaf: IType, ancestors: IType[]): void {
    this.leaves.add(leaf);
    for (const node of [leaf, ...ancestors.slice().reverse()]) {
      if (this.nodesWithLeaves.has(node)) {
        return;
      }
      this.nodesWithLeaves.add(node);
    }
  }

  // True when a marked child of the node above `side` has an id starting with the side's id, the
  // answer the leaf strings gave: a leaf under `ab` counts for a side `a`. see docs/TASKS.md #245
  //   e.g. (cycles-by-route.yaml) side res:r of get:/nodes, marked once the walk reaches Node.id
  public hasLeafUnder(side: IType): boolean {
    const sideId = Naming.abbreviateRef(side.id);
    return side.parent!.children.some(
      (sibling) => this.nodesWithLeaves.has(sibling) && Naming.abbreviateRef(sibling.id).startsWith(sideId),
    );
  }

  // Builds the prefix set of `entries` once per array: a later push to the same array is not seen,
  // the same rule the old per-array cache kept. see docs/TASKS.md #245
  //   e.g. (cycles-by-route.yaml) get:/nodes>res:r>** -> get:/nodes, get:/nodes>res:r, get:/nodes>res:r>**
  private entryPrefixes(): Set<string> {
    if (this.prefixesBuiltFrom === this.entries) {
      return this.prefixes;
    }
    this.prefixes = new Set<string>();
    for (const entry of this.entries) {
      this.prefixes.add(entry);
      for (let i = entry.indexOf(Naming.PATH_SEPARATOR); i !== -1; i = entry.indexOf(Naming.PATH_SEPARATOR, i + 1)) {
        this.prefixes.add(entry.slice(0, i));
      }
    }
    this.prefixesBuiltFrom = this.entries;
    return this.prefixes;
  }
}
