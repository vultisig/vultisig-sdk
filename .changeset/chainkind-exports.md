---
"@vultisig/sdk": minor
---

Expose chain-kind classification and Cosmos chain metadata from the SDK boundary so downstream consumers (mcp-ts, agent-backend) stop re-inventing per-chain tables (the cross-repo drift root cause):

- `getChainKind`, `isChainOfKind`, `ChainKind` (re-exported from `@vultisig/core-chain/ChainKind`) - classify a chain by family (evm/utxo/cosmos/...).
- `cosmosFeeCoinDenom`, `getCosmosGasLimit`, `getCosmosStakingGasLimit`, `cosmosRpcUrl` - Cosmos LCD/fee-denom/gas-limit metadata.

Unblocks the mcp-ts chain-classification consolidation (retiring ~291 lines of re-invented classification + duplicated cosmos chain config).
