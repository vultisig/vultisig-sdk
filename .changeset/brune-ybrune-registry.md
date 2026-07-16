---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

Register the Rujira liquid-bond THORChain tokens bRUNE (`x/brune`) and ybRUNE (`x/staking-x/brune`), and add the `bruneBondConfig` staking-contract config. bRUNE is auto-discovered as a normal wallet token priced against RUNE (`priceProviderId: 'thorchain'`); the ybRUNE auto-compounding staking receipt is excluded from wallet discovery and carries native-token metadata for backfill.
