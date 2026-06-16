// Connector / federation spec versions and the version-gating primitives that
// later roadmap items (R1+) build on.
//
// Gating contract: an emitter whose output requires a minimum connect spec
// version MUST either
//   - downgrade explicitly  -> branch on `meetsMinimum(target, min)` and emit a
//     documented fallback, or
//   - reject explicitly     -> call `requireConnectVersion(feature, target, min)`
//     which throws an actionable error.
// It must never silently emit a construct the target version cannot parse.
//
// Connect spec identifiers are plain `vMAJOR.MINOR` (e.g. "v0.4"). Ordering is fully
// defined by `(major, minor)` as integers.

// Authoritative list of connect spec identifiers we will emit in an `@link` URL.
export const SUPPORTED_CONNECT_VERSIONS = ['v0.1', 'v0.2', 'v0.3', 'v0.4', 'v0.5'] as const;
export type ConnectVersion = (typeof SUPPORTED_CONNECT_VERSIONS)[number];

// The newest version we can emit — and the default: no version asked for means LATEST.
export const LATEST_CONNECT_VERSION: ConnectVersion = SUPPORTED_CONNECT_VERSIONS[SUPPORTED_CONNECT_VERSIONS.length - 2];

export const DEFAULT_VERSIONS = {
  // LATEST released federation (2.15 is unreleased); connect v0.4 needs >= v2.13 so this
  // also satisfies the floor.
  federationVersion: 'v2.14',
  connectorSpecVersion: LATEST_CONNECT_VERSION,
} as const;

export type Versions = typeof DEFAULT_VERSIONS;

// vMAJOR.MINOR with an optional .PATCH (federation ships patches, e.g. "v2.14.1").
const VERSION_RE = /^v(\d+)\.(\d+)(?:\.(\d+))?$/;

/**
 * Parse a `vMAJOR.MINOR` string, with an optional `.PATCH` (e.g. "v0.3", "v2.14.1"). Throws
 * (actionable) on anything else. `patch` is omitted when absent, so a patchless version stays
 * `{ major, minor }`.
 */
export function parseVersion(v: string): { major: number; minor: number; patch?: number } {
  const m = VERSION_RE.exec(v);
  if (!m) {
    throw new Error(`Invalid version "${v}": expected format vMAJOR.MINOR or vMAJOR.MINOR.PATCH (e.g. "v0.3", "v2.14.1").`);
  }
  const parsed: { major: number; minor: number; patch?: number } = { major: Number(m[1]), minor: Number(m[2]) };
  // only attach patch when present — keeps patchless versions equal-by-shape to `{ major, minor }`
  if (m[3] !== undefined) {
    parsed.patch = Number(m[3]);
  }
  return parsed;
}

/** Order two versions by (major, minor, patch); a missing patch counts as 0. -1 a<b, 0 equal, 1 a>b. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  const patchA = pa.patch ?? 0;
  const patchB = pb.patch ?? 0;
  if (patchA !== patchB) return patchA < patchB ? -1 : 1;
  return 0;
}

/** Downgrade primitive: does `target` satisfy minimum `min`? */
export function meetsMinimum(target: string, min: string): boolean {
  return compareVersions(target, min) >= 0;
}

/** Lenient format check (used for federation, which we do not enumerate). */
export function assertVersionFormat(v: string): void {
  parseVersion(v);
}

/** Reject any connect version that is not a known identifier we can emit. */
export function assertSupportedConnectVersion(v: string): void {
  if (!(SUPPORTED_CONNECT_VERSIONS as readonly string[]).includes(v)) {
    throw new Error(
      `Unsupported connector spec version "${v}". ` + `Supported versions: ${SUPPORTED_CONNECT_VERSIONS.join(', ')}.`,
    );
  }
}

/** Reject primitive: throw if `target` is below the `min` a feature needs. */
export function requireConnectVersion(feature: string, target: string, min: string): void {
  if (!meetsMinimum(target, min)) {
    throw new Error(`${feature} requires connect ${min}, but target is ${target}`);
  }
}

/**
 * Real unions/interfaces need connect v0.4; below that the only valid form is the consolidate
 * downgrade. Derived from the version when not chosen explicitly; an explicit choice is
 * respected unless it would emit constructs the target cannot parse — that downgrades loudly
 * (the R0 contract: never silently emit what the target can't read). see ROADMAP R2
 */
export function resolveConsolidateUnions(connect: string, explicit?: boolean): boolean {
  const supportsAbstractTypes = meetsMinimum(connect, 'v0.4');
  if (explicit === false && !supportsAbstractTypes) {
    console.warn(
      `Warning: real unions/interfaces require connect v0.4, but target is ${connect} — ` +
        'downgrading to consolidated unions.',
    );
    return true;
  }
  return explicit ?? !supportsAbstractTypes;
}

export function warnIfExperimentalConnectVersion(v: string): void {
  if (v === 'v0.5') {
    console.warn(
      'Warning: connect v0.5 is experimental (preview). Composition and the router ' +
        'must support the @mapping preview; released builds reject connect v0.5.',
    );
  }
}

/**
 * Validate the version options resolved for a generator. Call once where options
 * are finalized (the generator entry points) so a bad value fails fast instead of
 * being emitted verbatim into an `@link` URL the router cannot resolve.
 */
export function validateVersionOptions(opts: { connectorSpecVersion?: string; federationVersion?: string }): void {
  const connect = opts.connectorSpecVersion ?? DEFAULT_VERSIONS.connectorSpecVersion;
  const federation = opts.federationVersion ?? DEFAULT_VERSIONS.federationVersion;
  assertSupportedConnectVersion(connect);
  assertVersionFormat(federation);
  warnIfExperimentalConnectVersion(connect);
}
