---
'@vultisig/sdk': patch
---

Move `formatUsdc` next to `parseUsdcAmount` in `tools/parse/usdcAmount.ts`, so its two independent copies in `buildCctpBridge.ts` and `threeJane/buildSupplyUsdc.ts` become one shared implementation. It renders the `amountUsdc` string a user reads on a signing card, so a drift between the copies would show the same amount two different ways depending on which builder produced it. Also exports it from `@vultisig/sdk/tools/defi/threeJane`, matching how `parseUsdcAmount` is already surfaced there; the existing `tools/bridge` export path is unchanged.
