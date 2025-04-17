import { CircularRef, Composed, En, Obj, Prop, PropArray, PropScalar, Ref, Scalar, Union } from './internal.js';

import { IType } from './internal.js';
import _ from 'lodash';

export class T {
  public static isLeaf(type: IType): boolean {
    return (
      type instanceof Scalar ||
      type instanceof PropScalar ||
      type instanceof En ||
      type instanceof CircularRef ||
      (type instanceof PropArray && type.items instanceof Scalar) ||
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

  static composables(node: IType): IType[] {
    return _.filter(T.containers(node), e => e.id.startsWith('comp:')) // || e.id.startsWith('union:'));
    // return T.containers(node)
    //   .mat((t) => t instanceof Composed || t instanceof Union);
  }

  public static print(node: IType, prefix: string = '', isLast: boolean = true): string {
    // Build the current line with the appropriate connector.
    const connector = prefix === '' ? '' : (isLast ? '└─ ' : '├─ ');
    let result = prefix + connector + node.id + '\n';

    // Prepare the prefix for the children.
    const childPrefix = prefix + (isLast ? '  ' : '│ ');

    node.children.forEach((child, index) => {
      const last = index === node.children.length - 1;
      result += T.print(child, childPrefix, last);
    });

    return result;
  }

}
