/**
 * Default budget (ms) for DKLS / Schnorr / ML-DSA relay message loops.
 *
 * DKLS and ML-DSA treat roughly 2× this value as the maximum wall-clock time for a single
 * inbound polling loop before aborting. Schnorr uses 1×.
 *
 * 60s was too tight for 3-party keygen or multi-chain key import on the public relay
 * (E2E flakes: premature "DKLS key import failed" and Vitest timeouts).
 */
export const DEFAULT_MPC_RELAY_ROUND_TIMEOUT_MS = 180_000
