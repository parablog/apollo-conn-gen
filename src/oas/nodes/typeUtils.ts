import { Arr, CircularRef, En, IType, Obj, Prop, PropArray, PropEn, PropScalar, Scalar } from './internal.js';
import _ from 'lodash';

export class T {
  public static isLeaf(type: IType): boolean {
    return (
      type instanceof Scalar ||
      type instanceof PropScalar ||
      type instanceof En ||
      type instanceof PropEn ||
      type instanceof CircularRef ||
      (type instanceof PropArray && type.items instanceof Scalar) ||
      (type instanceof Obj && _.isEmpty(type.props)) ||
      T.isScalarArray(type)
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
      .filter((child) => !(child instanceof Prop) && T.isContainer(child))
      .map((child) => child);
  }

  public static isContainer(node: IType): boolean {
    return node.id.startsWith('obj:') || node.id.startsWith('comp:') || node.id.startsWith('union:');
  }

  static composables(node: IType): IType[] {
    return _.filter(T.containers(node), (e: IType) => e.id.startsWith('comp:')); // || e.id.startsWith('union:'));
  }

  public static print(node: IType, prefix: string = '', isLast: boolean = true): string {
    // Build the current line with the appropriate connector.
    const connector = prefix === '' ? '' : isLast ? '└─ ' : '├─ ';
    let result = prefix + connector + node.id + '\n';

    // Prepare the prefix for the children.
    const childPrefix = prefix + (isLast ? '   ' : '│  ');

    node.children.forEach((child, index) => {
      const last = index === node.children.length - 1;
      result += T.print(child, childPrefix, last);
    });

    return result;
  }

  public static isRef(name: string) {
    return name.startsWith('#/components/');
  }

  public static findNonPropParent(type: IType) {
    let parent = type;
    while (parent instanceof Prop) {
      parent = parent.parent!;
    }
    return parent;
  }

  public static isScalarArray(type: IType) {
    return type instanceof Arr && type.itemsType instanceof Scalar;
  }
}
