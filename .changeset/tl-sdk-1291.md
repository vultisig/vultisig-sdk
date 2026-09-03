---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Add an SDK-owned general swap quote policy helper for backend/chat consumers. The new policy exports the default quote slippage tolerance, the same-chain EVM ERC-20 provider exclusions for route-dependent approval-spender providers, and metadata explaining the provider risk classification.
