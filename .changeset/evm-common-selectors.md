---
'@vultisig/core-chain': minor
---

Add a static lookup table of ~25 common EVM function selectors (`chains/evm/contract/commonSelectors.ts`) with human-readable action labels, and consult it as an offline fast-path in `getEvmContractCallInfo` before falling back to the 4byte API. Resolved entries now expose an optional `actionLabel` (e.g. "Token Approval", "Token Swap", "NFT Transfer") on the returned info.
