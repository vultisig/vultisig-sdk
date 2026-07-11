---
"@vultisig/sdk": patch
"@vultisig/cli": patch
---

Re-export the RN-safe `parseChain`, `parseTicker`, and `knownContracts` helpers from `@vultisig/sdk/platforms/react-native` so mobile consumers can use the SDK's canonical public helpers without maintaining local copies or reaching into non-RN entrypoints.
