---
"@vultisig/core-chain": minor
"@vultisig/sdk": patch
---

Add custom token support for SUI. SUI is now included in
`chainsWithTokenMetadataDiscovery`, and a new resolver fetches coin metadata
(ticker, decimals, logo) from the SUI RPC via `suix_getCoinMetadata`. A new
`isValidTokenId` helper validates token identifiers per chain — SUI tokens are
validated as Move struct tags (e.g. `0x2::sui::SUI`) while all other chains keep
delegating to `isValidAddress`.
