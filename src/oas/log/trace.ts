import { OasContext } from '../oasContext.js';

export function trace(ctx: OasContext | null, loc: string, log: string) {
  console.log(' '.repeat(ctx?.size() ?? 0), loc, log);
}

export function warn(ctx: OasContext | null, loc: string, log: string) {
  console.error(' '.repeat(ctx?.size() ?? 0), loc, log);
}
