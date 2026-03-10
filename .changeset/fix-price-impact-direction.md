---
"@vultisig/rujira": patch
---

Fix price impact calculation returning hardcoded 50% for small trades on deep pairs

- Remove hardcoded 50% cap on price impact values
- Add bidirectional price comparison to handle both swap directions correctly
  (buying base vs selling base relative to orderbook convention)
- Return 'unknown' instead of guessed ranges when orderbook data is unavailable
- Return 'unknown' when calculated impact exceeds 99% (likely unit mismatch)
