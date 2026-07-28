---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

fix(cosmos): sign `CosmosSpecific.gas` verbatim so co-signing matches iOS/Android

`CosmosSpecific.gas` (proto field 3) is the fee AMOUNT — commondata#93 documents
it as such and every other client signs it verbatim. The signing-inputs and
fee-display resolvers were instead re-deriving it as
`ceil(gas × relayedGasLimit / staticGasLimit)`, and doubling it for IBC
transfers. That silently redefined a shared wire field in one client: on a
TerraClassic LUNC send with a simulated gas limit of 321,979 the extension
signed a 21.465267 LUNC fee while the iOS co-signer signed the payload's
20 LUNC, the SignDocs diverged, and the MPC keysign never completed.

Both read paths now use `gas` as-is and only resolve the gas LIMIT from field 7.
Fee headroom moved to the initiator, which prices `gas` against the limit it
relays — matching iOS `CosmosGasPricedFee.scaled` and Android
`TerraClassicTax.baseGas`. The COSMOS-02 IBC source-leg headroom is preserved by
relaying the widened limit in `gas_limit` instead of applying a multiplier that
no other client can reproduce.

`resolveCosmosGasFee` is replaced by `resolveCosmosGasLimit` (limit resolution)
and `scaleCosmosFeeAmount` (initiator-only pricing).
