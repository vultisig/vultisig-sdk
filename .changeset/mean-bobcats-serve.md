---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export `getEvmRpcUrl` from the root SDK entrypoint and have the CLI agent executor use the shared EVM RPC resolver for gas refreshes and pending nonce checks.