---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

feat(custom-rpc): app-wide per-chain custom RPC endpoint overrides

Add an in-memory override registry that the EVM and Cosmos URL resolvers consult, so a host app can point a supported chain at its own node. v1 covers the EVM chains and the IBC-enabled Cosmos chains; the override maps to the EVM RPC URL for EVM chains and to the LCD/REST endpoint for Cosmos (balance fallback, account info, fee). Includes `customRpcSupportedChains` as a single source of truth and an `rpcHealthProbe` (EVM `eth_chainId` identity check, Cosmos `node_info` liveness). Default behaviour is byte-identical when no override is set.
