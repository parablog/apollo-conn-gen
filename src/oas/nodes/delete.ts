import { Post } from './internal.js';
import { Operation } from 'oas/operation';
import { OasContext } from '../oasContext.js';
import { Naming } from '../utils/naming.js';
import _ from 'lodash';

export class Delete extends Post {
  public verb: string = 'DELETE';

  constructor(name: string, operation: Operation) {
    super(name, operation);
  }

  forPrompt(_context: OasContext): string {
    return `[delete] ${this.name}`;
  }

  get id(): string {
    return `del:${this.name}`;
  }

  public getGqlOpName(): string {
    return 'delete' + _.upperFirst(Naming.genOperationName(this.operation.path, this.operation));
  }
}
