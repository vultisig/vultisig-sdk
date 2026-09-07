---
'@vultisig/core-mpc': minor
'@vultisig/core-chain': minor
---

Publish the SwapKit swap-fee work to the core packages that hold it. #2315 landed
`swap_fee` on `SwapKitSwapPayload`, the `getKeysignSwapFeeFields` reader, and the
`sub_provider` route tag in `@vultisig/core-mpc`, plus the transfer-route fee
resolution in `@vultisig/core-chain` — but its changeset named only
`@vultisig/sdk`, so neither core package was versioned and the release skipped
both. Clients that consume `@vultisig/core-mpc` directly, rather than through
`@vultisig/sdk`, cannot reach the new fee group or its reader until these are
republished.
