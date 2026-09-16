---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': patch
---

Send an `approve(0)` reset before the approve when a USDT-style token would reject a non-zero to non-zero approve over a stale partial allowance. The need for the reset is stated on the wire (`Erc20ApprovePayload.reset_allowance_first`, commondata#111) so every co-signer builds the same extra leg. `buildCowSwapApprovalSigningInput` is now `buildCowSwapApprovalSigningInputs` and returns every approve leg in nonce order.
