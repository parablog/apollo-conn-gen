import { IType, Prop, T, Union } from '../nodes/internal.js';
import { Naming } from './naming.js';
import { warn } from '../log/trace.js';
import type { OasContext } from '../oasContext.js';

export class SelectionPath {
  private static readonly CIRCULAR_REF_PREFIX = 'prop:circular-ref:#';

  // The selection that takes an operation's whole subtree. e.g. everythingUnder('get:/graph') -> 'get:/graph>**'
  public static everythingUnder(opId: string): string {
    return `${opId}${Naming.PATH_SEPARATOR}**`;
  }

  // One selection path segment, matched by id — or, when its name has drifted, by the one node the
  // parent can possibly mean. e.g. (digitalocean.yaml) the same node, spelled two ways:
  //   get:/v2/apps/{app_id}/deployments>res:r>…>prop:array:#deployments
  //    └─ obj:type:ActiveDeployment                                  <- a fresh run
  //    └─ obj:type:inlinev2AppsDeploymentsResponseActiveDeployment   <- minted while browsing, after
  //                                                                     /v2/apps claimed the name. #72
  public static resolveSegment(
    context: OasContext,
    parent: IType | undefined,
    collection: IType[],
    part: string,
  ): IType | undefined {
    // the segment as written, among the parent's children:
    //   res:r                                        part: comp:type:v2AppsDeploymentsResponse
    //    └─ comp:type:v2AppsDeploymentsResponse  <-  match
    const exact = collection.find((t) => t.id === part);
    if (exact) {
      return exact;
    }

    // Only a parent holding ONE node of the segment's kind may answer for a renamed segment:
    //   prop:array:#deployments                  obj:type:[inline:v2AppsDeploymentsResponse]
    //    └─ obj:type:ActiveDeployment             ├─ prop:array:#deployments
    //    one target -> recovered                  └─ prop:scalar:…        several -> nothing,
    //                                                                     the caller throws
    const target = T.innerChild(parent);
    if (target && SelectionPath.sameIdClass(target.id, part)) {
      warn(null, '[selection]', `segment ${part} not found; using ${target.id} (the only ${part.split(':')[0]} here)`);
      return target;
    }

    // Resolves an old circular-reference field to the parent's field of the same name: each component
    // is built once now, so the field is built as usual and its loop is left out on the walk. #242
    //   e.g. (keep-field-names.yaml) `...>obj:type:#/c/s/Item>prop:circular-ref:#parent_item` -> prop:obj:parent_item
    if (part.startsWith(SelectionPath.CIRCULAR_REF_PREFIX)) {
      const name = part.slice(SelectionPath.CIRCULAR_REF_PREFIX.length);
      const field = collection.find((t) => t instanceof Prop && t.name === name);
      if (field) {
        warn(null, '[selection]', `segment ${part} not found; using ${field.id} (the field of the same name)`);
        return field;
      }
    }

    // A saved path can still name a field that was directly on the union before it became a mixed
    // value; it resolves to the union, whose fields are all written anyway.
    //   e.g. (ashby) old `...>union:type:valueUnion>prop:scalar:currencyCode` resolves to the union.
    if (parent instanceof Union && parent.isFlat() && parent.analyzeMixedValue(context, true)) {
      warn(
        null,
        '[selection]',
        `${part} is no longer a direct field of ${parent.id}: the union now has one field per kind, and all of them are selected`,
      );
      return parent;
    }

    // An allOf wrapper's members are direct children, so T.innerChild above can't pick just one:
    //   container: allOf[$ref SharedPart, { aOnly }]
    // its plain member is named after the wrapper, and renamed along with it -- so if only one
    // sibling still carries "[inline:", that renamed member is the one the old segment meant.
    if (part.includes('[inline:')) {
      const inlineMatches = collection.filter(
        (t) => SelectionPath.sameIdClass(t.id, part) && t.id.includes('[inline:'),
      );
      if (inlineMatches.length === 1) {
        const [renamedInlineMember] = inlineMatches;
        warn(
          null,
          '[selection]',
          `segment ${part} not found; using ${renamedInlineMember.id} (the only renamed inline member here)`,
        );
        return renamedInlineMember;
      }
    }

    return undefined;
  }

  // Same kind of node: `obj:type:A` can stand in for `obj:type:B`, never for a `comp:` or a `prop:`.
  private static sameIdClass(idA: string, idB: string): boolean {
    return idA.split(':')[0] === idB.split(':')[0];
  }
}
