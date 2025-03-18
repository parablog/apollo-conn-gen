import { CircularRef } from '../nodes/circularRef.js';
import { En } from '../nodes/en.js';
import { PropArray } from '../nodes/props/propArray.js';
import { PropScalar } from '../nodes/props/propScalar.js';

import { IType } from '../nodes/iType.js';

export class T {
  public static isLeaf(type: IType): boolean {
    return (
      type instanceof PropScalar ||
      type instanceof En ||
      type instanceof CircularRef ||
      (type instanceof PropArray && type.items instanceof PropScalar)
    );
  }

  public static isPropScalar(type: IType): boolean {
    return type instanceof PropScalar;
  }

  public static traverse(node: IType, callback: (node: IType) => void): void {
    const traverseNode = (n: IType): void => {
      callback(n);

      for (const c of n.children) {
        traverseNode(c);
      }
    };

    traverseNode(node);
  }
}
