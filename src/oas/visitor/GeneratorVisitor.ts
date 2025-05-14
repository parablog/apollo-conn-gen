import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import {
  Arr,
  CircularRef,
  Composed,
  En,
  Obj,
  Param,
  Prop,
  PropArray,
  PropCircRef,
  PropComp,
  PropEn,
  PropObj,
  PropScalar,
  Res,
  Scalar,
  Union,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  IType,
} from '../nodes/internal.js';
import { NodeVisitor } from './NodeVisitor.js';
import { trace } from '../log/trace.js';

/**
 * Implementation of the Visitor pattern for node generation
 */
export class GeneratorVisitor implements NodeVisitor {
  /**
   * Generate output for a node
   */
  generate(node: IType, context: OasContext, writer: Writer, selection: string[]): void {
    this.visit(node, context, writer, selection);
  }

  // Basic types
  visitArray(node: Arr, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [array::generate]', `-> in: ${node.name}`);

    writer.write('[');
    if (node.itemsType) {
      this.visit(node.itemsType, context, writer, selection);
    }
    writer.write(']');

    trace(context, '<- [array::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitCircularRef(node: CircularRef, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [circularRef::generate]', `-> in: ${node.name}`);

    writer.write(node.name);

    trace(context, '<- [circularRef::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitComposed(node: Composed, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [composed::generate]', `-> in: ${node.name}`);

    writer.write('{');

    const props = Array.from(node.props.values());
    for (let i = 0; i < props.length; i++) {
      this.visit(props[i], context, writer, selection);
      if (i < props.length - 1) {
        writer.write(', ');
      }
    }

    writer.write('}');

    trace(context, '<- [composed::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitEnum(node: En, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [enum::generate]', `-> in: ${node.name}`);

    writer.write(node.name);

    trace(context, '<- [enum::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitObject(node: Obj, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [object::generate]', `-> in: ${node.name}`);

    writer.write('{');

    const props = Array.from(node.props.values());
    for (let i = 0; i < props.length; i++) {
      this.visit(props[i], context, writer, selection);
      if (i < props.length - 1) {
        writer.write(', ');
      }
    }

    writer.write('}');

    trace(context, '<- [object::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitResponse(node: Res, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [response::generate]', `-> in: ${node.name}`);

    if (node.schema) {
      writer.write(JSON.stringify(node.schema));
    }

    trace(context, '<- [response::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitScalar(node: Scalar, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [scalar::generate]', `-> in: ${node.name}`);

    writer.write(node.name);

    trace(context, '<- [scalar::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitUnion(node: Union, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [union::generate]', `-> in: ${node.name}`);

    const children = node.children || [];
    for (let i = 0; i < children.length; i++) {
      this.visit(children[i], context, writer, selection);
      if (i < children.length - 1) {
        writer.write(' | ');
      }
    }

    trace(context, '<- [union::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  // Operations
  visitGet(node: Get, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [get::generate]', `-> in: ${node.name}`);

    // Implementation depends on specific needs

    trace(context, '<- [get::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitPost(node: Post, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [post::generate]', `-> in: ${node.name}`);

    // Implementation depends on specific needs

    trace(context, '<- [post::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitPut(node: Put, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [put::generate]', `-> in: ${node.name}`);

    // Implementation depends on specific needs

    trace(context, '<- [put::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitPatch(node: Patch, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [patch::generate]', `-> in: ${node.name}`);

    // Implementation depends on specific needs

    trace(context, '<- [patch::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitDelete(node: Delete, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [delete::generate]', `-> in: ${node.name}`);

    // Implementation depends on specific needs

    trace(context, '<- [delete::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitBody(node: Body, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [body::generate]', `-> in: ${node.name}`);

    if (node.schema) {
      writer.write(JSON.stringify(node.schema));
    }

    trace(context, '<- [body::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  // Properties
  visitParam(node: Param, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [param::generate]', `-> in: ${node.name}`);

    writer.write(node.name);
    writer.write(': ');

    if (node.schema) {
      writer.write(JSON.stringify(node.schema));
    }

    trace(context, '<- [param::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitProp(node: Prop, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [prop::generate]', `-> in: ${node.name}`);

    writer.write(node.name);
    writer.write(': ');

    if (node.children && node.children.length > 0) {
      this.visit(node.children[0], context, writer, selection);
    }

    trace(context, '<- [prop::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitPropArray(node: PropArray, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [propArray::generate]', `-> in: ${node.name}`);

    writer.write(node.name);
    writer.write(': ');

    if (node.children && node.children.length > 0) {
      this.visit(node.children[0], context, writer, selection);
    }

    trace(context, '<- [propArray::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitPropCircRef(node: PropCircRef, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [propCircRef::generate]', `-> in: ${node.name}`);

    writer.write(node.name);
    writer.write(': ');

    if (node.children && node.children.length > 0) {
      this.visit(node.children[0], context, writer, selection);
    }

    trace(context, '<- [propCircRef::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitPropComp(node: PropComp, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [propComp::generate]', `-> in: ${node.name}`);

    writer.write(node.name);
    writer.write(': ');

    if (node.children && node.children.length > 0) {
      this.visit(node.children[0], context, writer, selection);
    }

    trace(context, '<- [propComp::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitPropEnum(node: PropEn, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [propEnum::generate]', `-> in: ${node.name}`);

    writer.write(node.name);
    writer.write(': ');

    if (node.children && node.children.length > 0) {
      this.visit(node.children[0], context, writer, selection);
    }

    trace(context, '<- [propEnum::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitPropObject(node: PropObj, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [propObject::generate]', `-> in: ${node.name}`);

    writer.write(node.name);
    writer.write(': ');

    if (node.children && node.children.length > 0) {
      this.visit(node.children[0], context, writer, selection);
    }

    trace(context, '<- [propObject::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  visitPropScalar(node: PropScalar, context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(node);
    trace(context, '-> [propScalar::generate]', `-> in: ${node.name}`);

    writer.write(node.name);
    writer.write(': ');

    if (node.children && node.children.length > 0) {
      this.visit(node.children[0], context, writer, selection);
    }

    trace(context, '<- [propScalar::generate]', `-> out: ${node.name}`);
    context.leave(node);
  }

  /**
   * Visit a node by dispatching to the appropriate method based on its id
   */
  visit(node: IType, context: OasContext, writer: Writer, selection: string[]): void {
    const id = node.id;

    if (id.startsWith('array:')) {
      this.visitArray(node as Arr, context, writer, selection);
    } else if (id.startsWith('circularRef:')) {
      this.visitCircularRef(node as CircularRef, context, writer, selection);
    } else if (id.startsWith('comp:')) {
      this.visitComposed(node as Composed, context, writer, selection);
    } else if (id.startsWith('en:')) {
      this.visitEnum(node as En, context, writer, selection);
    } else if (id.startsWith('obj:')) {
      this.visitObject(node as Obj, context, writer, selection);
    } else if (id.startsWith('res:')) {
      this.visitResponse(node as Res, context, writer, selection);
    } else if (id.startsWith('scalar:')) {
      this.visitScalar(node as Scalar, context, writer, selection);
    } else if (id.startsWith('union:')) {
      this.visitUnion(node as Union, context, writer, selection);
    } else if (id.startsWith('get:')) {
      this.visitGet(node as Get, context, writer, selection);
    } else if (id.startsWith('post:')) {
      this.visitPost(node as Post, context, writer, selection);
    } else if (id.startsWith('put:')) {
      this.visitPut(node as Put, context, writer, selection);
    } else if (id.startsWith('patch:')) {
      this.visitPatch(node as Patch, context, writer, selection);
    } else if (id.startsWith('delete:')) {
      this.visitDelete(node as Delete, context, writer, selection);
    } else if (id.startsWith('body:')) {
      this.visitBody(node as Body, context, writer, selection);
    } else if (id.startsWith('param:')) {
      this.visitParam(node as Param, context, writer, selection);
    } else if (id.startsWith('prop:')) {
      // Check for more specific prop types
      if (id.includes('array')) {
        this.visitPropArray(node as PropArray, context, writer, selection);
      } else if (id.includes('circRef')) {
        this.visitPropCircRef(node as PropCircRef, context, writer, selection);
      } else if (id.includes('comp')) {
        this.visitPropComp(node as PropComp, context, writer, selection);
      } else if (id.includes('enum')) {
        this.visitPropEnum(node as PropEn, context, writer, selection);
      } else if (id.includes('obj')) {
        this.visitPropObject(node as PropObj, context, writer, selection);
      } else if (id.includes('scalar')) {
        this.visitPropScalar(node as PropScalar, context, writer, selection);
      } else {
        this.visitProp(node as Prop, context, writer, selection);
      }
    } else {
      console.warn(`Unknown node type from id ${id}: ${node?.constructor?.name || typeof node}`);
    }
  }
}
