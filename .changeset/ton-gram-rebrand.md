---
"@vultisig/core-chain": patch
"@vultisig/sdk": patch
---

feat(ton): rebrand native token Toncoin (TON) → Gram (GRAM)

The Open Network renamed its native token TON → GRAM (effective 2026-06-15).
Update the display fields of `chainFeeCoin[Chain.Ton]`: `ticker` `TON` → `GRAM`
and `logo` `ton` → `gram`. This is a cosmetic token rebrand only — the chain
identity (`Chain.Ton`), `priceProviderId` (`the-open-network`), and `decimals`
are unchanged, and there is no swap/migration. Patch-bumps `@vultisig/sdk` to
rebundle.
