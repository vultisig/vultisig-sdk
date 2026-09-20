---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Bittensor sends now encode `Balances.transfer_keep_alive` (pallet 5, call 3) instead of `transfer_allow_death`, so a normal TAO transfer can no longer reap the sender — matching the extrinsic iOS and Android already sign, which restores mixed-vault co-signing. `getMaxSendableAmount` (new in `@vultisig/core-chain/amount`) keeps the 500 rao existential deposit back on top of the fee, and both `getMaxSendAmount`/`getMaxSendAmountFromKeys` and the keysign amount refinement use it, so a MAX quoted as `balance - fee` is clamped to what a keep-alive transfer accepts. A dust send that would leave the destination below the existential deposit is rejected before the ceremony with `BuildKeysignPayloadError('bittensor-destination-below-existential-deposit')`. `buildBittensorSigningPayload` takes an explicit `allowDeath` opt-in for a future empty-the-account flow.

The SDK is now a compatible co-signer for an explicit "empty the account" send: `PolkadotSpecific.allowDeath` (commondata) carries that intent from the initiator, and the Polkadot and Bittensor signing resolvers encode `transfer_allow_death` only when the payload says so, so the SDK signs the same bytes as an initiator that set it. Payloads that predate the field decode as keep-alive. The SDK does not offer the option to initiators yet; that waits until every platform's signer reads the field.
