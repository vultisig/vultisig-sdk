---
'@vultisig/core-chain': minor
---

feat(chain/evm): static known-contract label registry for offline transaction-intent display

Adds `chains/evm/contract/knownContracts.ts` mapping well-known EVM contract addresses (Uniswap V2/V3 routers, 1inch V5/V6, Permit2, THORChain Router, Aave V3 Pool) to human-readable labels and categories. Complements `commonSelectors.ts`: that table labels what function is being called, this one labels who is being called (and lets UIs label spender-style address arguments). Lookup is offline, case-insensitive, and optionally chain-scoped.
