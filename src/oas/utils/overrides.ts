import { OverrideEntry, OverridesConfig } from '../oasContext.js';

// The override entry for one operation: the first "$match" pattern matching its key, with the
// exact entry's fields laid over it, so an exact field wins.
//   e.g. { "$match": [{ "pattern": "\\.list$", "root": "query" }] } applies to post:/application.list
export function findOverride(opId: string, overrides: OverridesConfig | undefined): OverrideEntry | undefined {
  const matched = overrides?.$match?.find((entry) => new RegExp(entry.pattern).test(opId));
  const exact = overrides?.[opId] as OverrideEntry | undefined;
  return matched || exact ? { ...matched, ...exact } : undefined;
}
