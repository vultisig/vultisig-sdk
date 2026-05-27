---
'@vultisig/core-chain': minor
---

## Added

- `resolveTokenPriceId(chain, denomOrAddress?)` helper in `@vultisig/core-chain/coin/price/resolveTokenPriceId` - pure synchronous lookup against the SDK's curated registry (`chainFeeCoin` + `knownTokensIndex`) that returns a CoinGecko priceProviderId for a chain's native coin or a known token by address/denom. Returns `undefined` when no registry entry exists so callers can fall back to other resolution paths. Phase 1 of registry-driven cross-chain price resolution (refs vultisig/mcp-ts#255).
