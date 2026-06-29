---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

feat(swap): add Jupiter as a Solana same-chain swap provider with a VULT-scaled affiliate fee

`findSwapQuote` now offers Jupiter for on-Solana token pairs (SOL↔SPL, SPL↔SPL),
preferred over SwapKit/LiFi on a near-tie. Jupiter is Solana-only and same-chain
— it is never offered for any cross-chain route, and native SOL cross-chain swaps
stay on THORChain.

The Jupiter quote sends `platformFeeBps` = `max(0, 50 − vultTierDiscountBps)`
(the existing `getSwapAffiliateBps` value, shared with every other provider), and
the swap request sends `feeAccount` = the Associated Token Account of
`(owner = Vultisig fee wallet, mint = output mint)`. An idempotent
`createAssociatedTokenAccount` instruction for that fee ATA is prepended to the
returned transaction (Jupiter does not auto-create it). When the affiliate bps
floors to 0 (Ultimate-tier VULT holder), no platform fee or fee account is used.

New public surface: `swap/general/jupiter/*` (`getJupiterSwapQuote`,
`configureJupiter`, `jupiterSwapEnabledChains`) and `jupiter` added to
`generalSwapProviders` and the swap explorer providers.
