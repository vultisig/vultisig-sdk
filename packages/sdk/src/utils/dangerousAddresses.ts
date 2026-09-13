/**
 * Re-export of the canonical dangerous/burn-address guard, which now lives in
 * `@vultisig/core-chain/security/dangerousAddresses` so it can be imported by
 * BOTH the sdk build-tx primitives AND the lower-level core-chain swap/recipient
 * guards (core-chain cannot depend on the sdk). Kept here as a thin shim so the
 * existing sdk import path + public re-exports stay stable.
 */
export * from '@vultisig/core-chain/security/dangerousAddresses'

/**
 * Re-export of the canonical token-transfer / ERC-20-calldata destination
 * guards (architecture#1774) — same shim rationale as above: lives in
 * `core-chain` so both the SDK and lower-level core-chain guards can import
 * it, re-exported here so `@vultisig/sdk` consumers don't need to know that.
 */
export * from '@vultisig/core-chain/security/tokenTransferGuards'
