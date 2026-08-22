---
'@vultisig/sdk': patch
---

Reuse the shared queryUrl timeout default for React Native (was drifting to 30s vs 20s), and pin `LIFI_CHAIN_ID_SOL` against the live `@lifi/sdk` `ChainId.SOL` with a regression test so a LiFi renumber fails CI instead of drifting silently.
