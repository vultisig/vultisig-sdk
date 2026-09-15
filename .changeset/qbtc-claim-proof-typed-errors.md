---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

refactor(qbtc): migrate `assertValidClaimProofResponse` from plain `Error` to a typed `ClaimProofError`

All six response-shape assertions in `packages/core/chain/chains/cosmos/qbtc/claim/proofService.ts` now throw `ClaimProofError` (with a per-field `ClaimProofErrorCode`) instead of a plain `Error`, so callers can branch on `.code` instead of parsing message strings. Follows the existing `SwapError` / `SwapErrorCode` pattern in this package rather than reaching for `@vultisig/sdk`'s `VaultError` — `@vultisig/core-chain` doesn't depend on `@vultisig/sdk`, so the SDK-level error classes aren't available here.

No message-text changes; error messages are byte-identical to before.
