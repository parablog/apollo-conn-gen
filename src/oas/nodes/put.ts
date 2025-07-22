import { Post } from './internal.js';
import { Operation } from 'oas/operation';
import { OasContext } from '../oasContext.js';
import { Naming } from '../utils/naming.js';
import _ from 'lodash';

export class Put extends Post {
  public verb: string = 'PUT';

  constructor(name: string, operation: Operation) {
    super(name, operation);
  }

  public getGqlOpName(): string {
    return 'update' + _.upperFirst(Naming.genOperationName(this.operation.path, this.operation));
  }

  forPrompt(_context: OasContext): string {
    return `[put] ${this.name}`;
  }

  get id(): string {
    return `put:${this.name}`;
  }
}
