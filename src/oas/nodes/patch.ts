import { Post } from './internal.js';
import { Operation } from 'oas/operation';
import { OasContext } from '../oasContext.js';
import _ from 'lodash';
import { Naming } from '../utils/naming.js';

export class Patch extends Post {
  public verb: string = 'PATCH';

  constructor(name: string, operation: Operation) {
    super(name, operation);
  }

  forPrompt(_context: OasContext): string {
    return `[patch] ${this.name}`;
  }

  get id(): string {
    return `patch:${this.name}`;
  }

  public getGqlOpName(): string {
    return 'update' + _.upperFirst(Naming.genOperationName(this.operation.path, this.operation));
  }
}
