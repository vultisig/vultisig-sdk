---
'@vultisig/sdk': patch
---

Fix `isValidTokenSymbolFormat` / `normalizeTokenSymbol` rejecting canonical 2-char tickers (`OP`, `ZK`) that are already present in the `tokenDecimals` registry. A known short ticker now bypasses the 3-char shape floor (standalone or as one leg of a slash-pair), mirroring the Go backend's `knownTokenSymbols` allowlist bypass of its `symbolCandidateRe` extraction regex.
