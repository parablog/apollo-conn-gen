import { CircularRef, En, Obj, Prop, PropArray, PropScalar, Ref, Scalar } from './internal.js';

import { IType } from './internal.js';
import _ from 'lodash';

export class T {
  public static isLeaf(type: IType): boolean {
    return (
      type instanceof Scalar ||
      type instanceof PropScalar ||
      type instanceof En ||
      type instanceof CircularRef ||
      (type instanceof PropArray && type.items instanceof PropScalar) ||
      (type instanceof Obj && _.isEmpty(type.props))
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

  static isMutationType(type: IType): boolean {
    return (
      type.id.startsWith('post:') ||
      type.id.startsWith('put:') ||
      type.id.startsWith('patch:') ||
      type.id.startsWith('del:')
    );
  }

  static isScalar(type: IType): boolean {
    return type.id.startsWith('scalar:');
  }

  public static containers(node: IType) {
    return Array.from(node.children.values())
      .filter((child) => !(child instanceof Prop))
      .map((child) => (child.id.startsWith('ref:') ? (child as Ref).refType! : child));
  }
}
