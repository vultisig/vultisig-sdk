---
'@vultisig/sdk': patch
---

Keep tiny positive EVM gas prices visible in gas comparisons and calculate native fee estimates from raw wei so display rounding cannot erase or inflate them. Rank fully priced comparisons by unrounded USD costs so fees that display as zero still select the cheapest chain.
