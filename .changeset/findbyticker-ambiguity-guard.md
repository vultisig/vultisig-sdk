---
'@vultisig/sdk': patch
---

fix(coin): findByTicker throws on cross-chain ambiguity instead of a silent first-match (SDK2-02)

`findByTicker` resolved a bare ticker via `coins.find(c => c.ticker === ticker)` — array-order first match, no chain scoping. A symbol like "USDC" exists on many chains, so if this (currently-unreferenced public) helper were wired into a fund path it would silently resolve to whichever chain was first, sending to the wrong network. It now returns the unique match (or null when absent) and throws when the ticker is ambiguous across more than one chain, forcing the caller to disambiguate.
