---
"@vultisig/core-chain": patch
"@vultisig/core-mpc": patch
---

Fix native swaps from THORChain secured assets. Swap quotes now emit secured-asset notation (`CHAIN-ASSET`, e.g. `XRP-XRP`, `ETH-USDC-0x…`) instead of the L1 pool notation (`CHAIN.ASSET`) that THORNode rejects for `thor1`-settling swaps, and the spent secured asset is encoded correctly in the `MsgDeposit` (L1 chain and symbol derived from the denom, `secured` flag set). Applies to all secured assets and swap directions.
