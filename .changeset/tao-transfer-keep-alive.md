---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Bittensor sends now encode `Balances.transfer_keep_alive` (pallet 5, call 3) instead of `transfer_allow_death`, so a normal TAO transfer can no longer reap the sender — matching the extrinsic iOS and Android already sign, which restores mixed-vault co-signing. `getMaxSendableAmount` (new in `@vultisig/core-chain/amount`) keeps the 500 rao existential deposit back on top of the fee, and both `getMaxSendAmount`/`getMaxSendAmountFromKeys` and the keysign amount refinement use it, so a MAX quoted as `balance - fee` is clamped to what a keep-alive transfer accepts. A dust send that would leave the destination below the existential deposit is rejected before the ceremony with `BuildKeysignPayloadError('bittensor-destination-below-existential-deposit')`. `buildBittensorSigningPayload` takes an explicit `allowDeath` opt-in for a future empty-the-account flow; nothing sets it yet, and the keysign payload carries no such intent.
