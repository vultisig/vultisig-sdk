---
'@vultisig/sdk': patch
---

Export the canonical `tendermintRpcUrl` registry from the root and React Native SDK entrypoints so first-party TypeScript consumers resolve Cosmos/Tendermint RPC endpoints from the SDK instead of maintaining their own per-chain tables that drift.
