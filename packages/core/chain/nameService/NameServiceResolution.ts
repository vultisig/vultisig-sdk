/**
 * What looking a name up for a chain found. A name that exists without an
 * address on the chain is reported apart from one that does not exist.
 * Transport failures are thrown rather than returned, so they are never
 * mistaken for a missing name.
 */
export type NameServiceResolution =
  | { kind: 'resolved'; address: string }
  | { kind: 'notFound' }
  | { kind: 'noAddressForChain' }
