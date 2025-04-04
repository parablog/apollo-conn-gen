import { Post } from "./internal.js";
import { Operation } from 'oas/operation';
import { OasContext } from '../oasContext.js';

export class Put extends Post {
  public verb: string = 'PUT';

  constructor(name: string, operation: Operation) {
    super(name, operation);
  }

  forPrompt(_context: OasContext): string {
    return `[put] ${this.name}`;
  }

  get id(): string {
    return `put:${this.name}`;
  }
}