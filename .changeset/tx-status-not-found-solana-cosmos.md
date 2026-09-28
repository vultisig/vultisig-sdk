---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Transaction status lookups on Solana and Cosmos-family chains (THORChain, Maya, Cosmos Hub, …) now report `not_found` when the node has no record of the hash, matching EVM, instead of an indefinite `pending`. On Solana, a transient RPC failure and an unseen signature whose `lastValidBlockHeight` has not expired still report `pending`.
