/**
 * Re-export of the canonical dangerous/burn-address guard, which now lives in
 * `@vultisig/core-chain/security/dangerousAddresses` so it can be imported by
 * BOTH the sdk build-tx primitives AND the lower-level core-chain swap/recipient
 * guards (core-chain cannot depend on the sdk). Kept here as a thin shim so the
 * existing sdk import path + public re-exports stay stable.
 */
export * from '@vultisig/core-chain/security/dangerousAddresses'
