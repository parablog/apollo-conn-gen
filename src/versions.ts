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

export const DEFAULT_VERSIONS = {
  // Kept in lock-step with the connect default: connect v0.3 requires federation
  // >= v2.12 (per the Apollo connectors version-requirements matrix).
  federationVersion: 'v2.12',
  connectorSpecVersion: 'v0.3',
} as const;

export type Versions = typeof DEFAULT_VERSIONS;

// Authoritative list of connect spec identifiers we will emit in an `@link` URL.
export const SUPPORTED_CONNECT_VERSIONS = ['v0.1', 'v0.2', 'v0.3', 'v0.4', 'v0.5'] as const;
export type ConnectVersion = (typeof SUPPORTED_CONNECT_VERSIONS)[number];

const VERSION_RE = /^v(\d+)\.(\d+)$/;

/** Parse a `vMAJOR.MINOR` string. Throws (actionable) on anything else. */
export function parseVersion(v: string): { major: number; minor: number } {
  const m = VERSION_RE.exec(v);
  if (!m) {
    throw new Error(`Invalid version "${v}": expected format vMAJOR.MINOR (e.g. "v0.3").`);
  }
  return { major: Number(m[1]), minor: Number(m[2]) };
}

/** Order two versions by (major, minor). -1 if a<b, 0 if equal, 1 if a>b. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
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

/** Non-blocking heads-up that v0.4/v0.5 are experimental and need router opt-in. */
export function warnIfExperimentalConnectVersion(v: string): void {
  if (v === 'v0.4') {
    console.warn(
      'Warning: connect v0.4 is experimental. The router must enable ' +
        '`connectors: preview_connect_v0_4: true` and use federation >= v2.13.',
    );
  } else if (v === 'v0.5') {
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
