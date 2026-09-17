// The corpus lint sweep's known-vs-new classification. Separate module so tests can import it —
// importing lint-corpus.mts itself would start a sweep (top-level await, argv reads at module scope).
import type { LintDiagnostic } from '../src/oas/lint/index.js';

export interface ClassifiableFinding {
  spec: string;
  op: string;
  code: string;
  field?: string;
}

// One filed gap. `field` matches a RESPONSE_FIELD_NOT_READ, `op` a RESPONSE_NOT_READ — a finding's
// own code decides which one applies, so an entry never answers for the other code's finding.
export interface Gap {
  spec: string;
  field?: string;
  op?: string;
  ref: string;
}

// The field name `reportFieldNotRead` writes as the message's own first backticked span.
// e.g. "`region_slug` is returned by `get:/actions` ..." -> "region_slug"; undefined for any other code.
export function fieldOf(diagnostic: LintDiagnostic): string | undefined {
  if (diagnostic.code !== 'RESPONSE_FIELD_NOT_READ') return undefined;
  return diagnostic.message.match(/^`([^`]*)`/)?.[1];
}

export function toClassifiable(spec: string, op: string, diagnostic: LintDiagnostic): ClassifiableFinding {
  return { spec, op, code: diagnostic.code, field: fieldOf(diagnostic) };
}

// Code-aware: a RESPONSE_FIELD_NOT_READ matches only by field, a RESPONSE_NOT_READ only by op, so
// one code's entry never covers the other's finding. Presence-checked, not truthy — field: '' still matches.
export function classify(finding: ClassifiableFinding, gaps: Gap[]): Gap | undefined {
  return gaps.find((gap) => {
    if (gap.spec !== finding.spec) return false;
    if (finding.code === 'RESPONSE_FIELD_NOT_READ') return gap.field !== undefined && gap.field === finding.field;
    if (finding.code === 'RESPONSE_NOT_READ') return gap.op !== undefined && gap.op === finding.op;
    return false;
  });
}

export function tally(findings: ClassifiableFinding[], gaps: Gap[]): { known: number; new: number } {
  return findings.reduce(
    (totals, finding) => {
      if (classify(finding, gaps)) totals.known++;
      else totals.new++;
      return totals;
    },
    { known: 0, new: 0 },
  );
}

// A blind op has no diagnostic to classify (ResponseCoverageCheck.walk only emits one when the
// spec actually declares properties at that level) and so stays outside known/new entirely.
export function decideExit(newCount: number, blindOps: number): 0 | 1 {
  return newCount > 0 || blindOps > 0 ? 1 : 0;
}
