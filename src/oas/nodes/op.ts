import { Body, IType, Param } from './internal.js';
import { Operation } from 'oas/operation';

export interface Op {
  verb: string;
  get id(): string;
  resultType?: IType;
  body?: Body;
  summary?: string;
  description?: string;
  params: Param[];
  operation: Operation;
}
