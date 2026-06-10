---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': patch
---

Add QBTC support to the Cosmos staking signing path and LCD query layer. QBTC
is a Cosmos-SDK chain (post-quantum testnet, ML-DSA-signed) but lives in
`OtherChain`, so it sat outside the staking helpers' typing and LCD root
resolution.

- `QBTCHelper.buildTxComponents` now consumes a `signData.signDirect` payload
  verbatim — the `bodyBytes` / `authInfoBytes` already carry the ML-DSA pubkey
  `Any`, gas and fee, so the initiator and every co-signing peer rebuild an
  identical SignDoc hash. Previously it always rebuilt the body from
  `transactionType` (MsgSend / IBC / Vote), which silently turned a staking
  SignDoc into a `MsgSend`. `signAmino` is rejected (ML-DSA is
  SIGN_MODE_DIRECT only). The normal send path (no `signData`) is unchanged.
- `chains/cosmos/staking/lcdQueries` exports a widened
  `StakingChain = IbcEnabledCosmosChain | Chain.QBTC` and resolves the LCD root
  through a helper that routes QBTC to `qbtcRestUrl` and every other staking
  chain to `cosmosRpcUrl[chain]`.

Backward compatible: existing IBC-enabled staking chains route exactly as
before.
