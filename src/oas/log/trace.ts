import { OasContext } from '../oasContext.js';

// Off unless the gen was built with verbose: true. A big spec (e.g. docusign, 400+ operations)
// can call this millions of times in one generation; an unconditional console.log queues that
// output in memory when the process's stdout is a pipe rather than a terminal, running the
// process out of memory well before generation finishes. see docs/FIXED.md #179
export function trace(ctx: OasContext | null, loc: string, log: string) {
  if (!ctx?.generateOptions.verbose) return;
  console.log(' '.repeat(ctx.size()), loc, log);
}

export function warn(ctx: OasContext | null, loc: string, log: string) {
  console.error(' '.repeat(ctx?.size() ?? 0), loc, log);
}
