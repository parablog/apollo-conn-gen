import { IType, T } from '../nodes/internal.js';
import { warn } from '../log/trace.js';

export class SelectionPath {
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

    return undefined;
  }

  // Same kind of node: `obj:type:A` can stand in for `obj:type:B`, never for a `comp:` or a `prop:`.
  private static sameIdClass(idA: string, idB: string): boolean {
    return idA.split(':')[0] === idB.split(':')[0];
  }
}
