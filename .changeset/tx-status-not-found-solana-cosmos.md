---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Transaction status lookups on Solana and Cosmos-family chains (THORChain, Maya, Cosmos Hub, …) now report `not_found` when the node has no record of the hash, matching EVM, instead of an indefinite `pending`. A hash the node knows about, or a lookup that fails transiently, still reports `pending`.
