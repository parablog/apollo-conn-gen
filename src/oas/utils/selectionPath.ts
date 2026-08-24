import { IType, T } from '../nodes/internal.js';
import { Naming } from './naming.js';
import { warn } from '../log/trace.js';

export class SelectionPath {
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
  public static resolveSegment(parent: IType | undefined, collection: IType[], part: string): IType | undefined {
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

    // An allOf wrapper's members are direct children, so T.innerChild above can't pick just one:
    //   container: allOf[$ref SharedPart, { aOnly }]
    // its plain member is named after the wrapper, and renamed along with it -- so if only one
    // sibling still carries "[inline:", that renamed member is the one the old segment meant.
    if (part.includes('[inline:')) {
      const inlineMatches = collection.filter((t) => SelectionPath.sameIdClass(t.id, part) && t.id.includes('[inline:'));
      if (inlineMatches.length === 1) {
        const [renamedInlineMember] = inlineMatches;
        warn(null, '[selection]', `segment ${part} not found; using ${renamedInlineMember.id} (the only renamed inline member here)`);
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
