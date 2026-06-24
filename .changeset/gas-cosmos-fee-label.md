---
'@vultisig/sdk': minor
---

Add `sdk.gas.cosmos` — cosmos gas-fee primitives (`estimateCosmosSwapFeeLabel`,
`getCosmosSwapGasLimit`, `COSMOS_SWAP_GAS_LIMIT`, `COSMOS_SWAP_FEE_LABEL_CHAINS`,
re-exported `getCosmosGasLimit`). The swap fee label is sourced from the SDK's
canonical `cosmosGasRecord` sign-time fee (single source of truth, identical to
the mcp-ts `COSMOS_SEND_FEE_BASE_UNITS` labels), covering all 8 IBC-enabled
cosmos chains. Exposed at the package index and the React Native entry point.
