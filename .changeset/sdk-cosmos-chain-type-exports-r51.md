---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export the canonical `IbcEnabledCosmosChain` and `VaultBasedCosmosChain` subsets from the root and React Native SDK entrypoints so first-party consumers can stop mirroring staking-chain allowlists.
