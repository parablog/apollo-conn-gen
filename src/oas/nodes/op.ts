import { IType, Param } from './internal.js';
import { Operation } from 'oas/operation';

export interface Op {
  verb: string;
  get id(): string;
  resultType?: IType;
  summary?: string;
  description?: string;
  params: Param[];
  operation: Operation;
}
