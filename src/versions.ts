export const DEFAULT_VERSIONS = {
  federationVersion: "v2.11",
  connectorSpecVersion: "v0.2",
} as const;

export type Versions = typeof DEFAULT_VERSIONS; 