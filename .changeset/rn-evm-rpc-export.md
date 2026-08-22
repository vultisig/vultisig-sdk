---
'@vultisig/sdk': patch
---

Export `getEvmRpcUrl` from the curated `@vultisig/sdk/react-native` entrypoint so React Native consumers can import the canonical custom-RPC-aware EVM resolver instead of keeping app-local copies.
