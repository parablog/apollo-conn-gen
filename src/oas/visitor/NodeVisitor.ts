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
} from '../nodes/internal.js';

/**
 * NodeVisitor interface defines methods for each node type in the AST
 */
export interface NodeVisitor {
  // Basic types
  visitArray(node: Arr, context: OasContext, writer: Writer, selection: string[]): void;
  visitCircularRef(node: CircularRef, context: OasContext, writer: Writer, selection: string[]): void;
  visitComposed(node: Composed, context: OasContext, writer: Writer, selection: string[]): void;
  visitEnum(node: En, context: OasContext, writer: Writer, selection: string[]): void;
  visitObject(node: Obj, context: OasContext, writer: Writer, selection: string[]): void;
  visitResponse(node: Res, context: OasContext, writer: Writer, selection: string[]): void;
  visitScalar(node: Scalar, context: OasContext, writer: Writer, selection: string[]): void;
  visitUnion(node: Union, context: OasContext, writer: Writer, selection: string[]): void;

  // Operations
  visitGet(node: Get, context: OasContext, writer: Writer, selection: string[]): void;
  visitPost(node: Post, context: OasContext, writer: Writer, selection: string[]): void;
  visitPut(node: Put, context: OasContext, writer: Writer, selection: string[]): void;
  visitPatch(node: Patch, context: OasContext, writer: Writer, selection: string[]): void;
  visitDelete(node: Delete, context: OasContext, writer: Writer, selection: string[]): void;
  visitBody(node: Body, context: OasContext, writer: Writer, selection: string[]): void;

  // Properties
  visitParam(node: Param, context: OasContext, writer: Writer, selection: string[]): void;
  visitProp(node: Prop, context: OasContext, writer: Writer, selection: string[]): void;
  visitPropArray(node: PropArray, context: OasContext, writer: Writer, selection: string[]): void;
  visitPropCircRef(node: PropCircRef, context: OasContext, writer: Writer, selection: string[]): void;
  visitPropComp(node: PropComp, context: OasContext, writer: Writer, selection: string[]): void;
  visitPropEnum(node: PropEn, context: OasContext, writer: Writer, selection: string[]): void;
  visitPropObject(node: PropObj, context: OasContext, writer: Writer, selection: string[]): void;
  visitPropScalar(node: PropScalar, context: OasContext, writer: Writer, selection: string[]): void;
}
