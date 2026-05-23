---
"@vultisig/sdk": patch
"@vultisig/core-chain": patch
---

chore: remove Station affiliate constants from shared SDK (closes #536)

Station-specific constants (`stvs` THORName, `0x649E…076D` EVM fee receiver) do not belong in a public package consumed by Windows and external users. The generic `affiliateConfig` injection seam on `findSwapQuote` + `SwapAffiliateConfig` type remain — those are correct SDK design. Station reconstructs the same three configs in its own consumer package (mcp-ts#201).
