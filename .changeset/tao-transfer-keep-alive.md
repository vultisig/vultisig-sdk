---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Bittensor sends now encode `Balances.transfer_keep_alive` (pallet 5, call 3) instead of `transfer_allow_death`, so a normal TAO transfer can no longer reap the sender — matching the extrinsic iOS and Android already sign, which restores mixed-vault co-signing. `getMaxSendableAmount` (new in `@vultisig/core-chain/amount`) keeps the 500 rao existential deposit back on top of the fee, and both `getMaxSendAmount`/`getMaxSendAmountFromKeys` and the keysign amount refinement use it, so a MAX quoted as `balance - fee` is clamped to what a keep-alive transfer accepts. A dust send that would leave the destination below the existential deposit is rejected before the ceremony with `BuildKeysignPayloadError('bittensor-destination-below-existential-deposit')`.

An explicit "empty the account" send is now expressible end to end: `PolkadotSpecific.allowDeath` (commondata) carries the intent to every co-signer, `prepareSendTx`/`prepareSendTxFromKeys`/`send`/`getMaxSendAmount` accept `allowDeath`, the Polkadot and Bittensor signing resolvers encode `transfer_allow_death` only when the payload says so, and the MAX/refinement then keep nothing back. Payloads that predate the field decode as keep-alive.
