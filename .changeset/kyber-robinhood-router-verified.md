---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Robinhood (4663) now declares the canonical Multicall3 on its viem chain, so balance discovery batches the whole token catalog in one call instead of falling back to one `eth_call` per token against the public RPC. The contract is deployed there with bytecode identical to the Ethereum and Base deployments; only the public deployment registry had not listed the chain. Also records that KyberSwap's MetaAggregationRouterV2 keeps its standard address on Robinhood: `/routes` and `/route/build` on the `robinhood` API path both return `0x6131b5fae19ea4f9d964eac0408e4408b66337b5` with buildable calldata, so the flat Kyber allowlist was already correct.
