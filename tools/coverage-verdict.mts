// The all-ops column's verdict from one rover compose failure output. Separate module so tests
// can import it — importing coverage-spec.mts itself would start a sweep (top-level main).
// e.g. 453 CONNECTORS_UNRESOLVED_FIELD + 2 INVALID_GRAPHQL ->
//      "FAIL [CONNECTORS_UNRESOLVED_FIELD ×453] +1 other codes"

// rover wraps everything in a generic [E029]; the actionable codes are the federation error
// names in the "Caused by:" body, one line per error — tally each code's own count.
export function wholeVerdict(out: string): { verdict: string; codes: string[] } {
  const tally = new Map<string, number>();
  for (const m of out.matchAll(/^\s*([A-Z][A-Z0-9_]{3,}):/gm)) {
    tally.set(m[1], (tally.get(m[1]) ?? 0) + 1);
  }
  if (tally.size === 0) {
    const outer = out.match(/\[(E[0-9]+)\]/);
    const code = outer ? outer[1] : 'OTHER';
    return { verdict: `FAIL [${code}]`, codes: [code] };
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const [top, count] = ranked[0];
  const others = ranked.length - 1;
  const verdict = `FAIL [${top} ×${count}]` + (others > 0 ? ` +${others} other codes` : '');
  return { verdict, codes: ranked.map(([c]) => c) };
}
