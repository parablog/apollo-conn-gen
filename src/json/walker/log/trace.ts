import { JsonContext } from '../jsonContext.js';

export function trace(ctx: JsonContext | null, context: string, message: string): void {
  const count = ctx ? ctx.getStack().length : 0;
  const logMessage = ' '.repeat(count) + `(${count})` + context + ' ' + message;
  console.log(logMessage);
}

export function warn(ctx: JsonContext | null, context: string, message: string): void {
  const count = ctx ? ctx.getStack().length : 0;
  const logMessage = ' '.repeat(count) + context + ' ' + message;
  console.warn(logMessage);
}
