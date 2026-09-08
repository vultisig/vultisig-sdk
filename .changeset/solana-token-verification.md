---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

feat(solana): verified / unverified / scam classification for SPL tokens, and verified-only discovery

Solana discovery kept a mint when a price id could be found for it. That hid legitimate tokens that simply had no CoinGecko listing, and did nothing about the airdropped counterfeits and zero-decimal spam a Solana wallet accumulates — a priced impostor was auto-added, an unpriced real token was not, and neither carried a label.

`findSolanaCoins` now returns **verified mints only**, priced or not, mirroring TON. Zero-balance token accounts are skipped, Jupiter's search endpoint answers for a hundred mints per call instead of one call per token, CoinGecko ids come from its on-chain multi-token endpoint thirty mints per call, decimals come from the token account itself, and curated metadata wins for tokens we ship ourselves. When Jupiter cannot be reached, listed mints are still discovered from the registry's metadata; a failed price-id lookup, by contrast, fails the round instead of saving the token without a price id for good. Unverified and scam mints can still be added by hand, where the UI labels them.

Verification lives in `@vultisig/core-chain/chains/solana/spl/verification`. The registry of verified mints (`chains/solana/spl/verifiedRegistry`) merges our curated Solana tokens with Jupiter's verified list, fetched once an hour and degrading to the curated list alone when unreachable. `resolveSolanaTokenVerification` is pure: a listed mint — or one Jupiter itself flags verified — is `verified`; an unlisted mint is `scam` when its symbol or name collapses onto a verified token's, and `unverified` otherwise. `getSolanaTokenVerification({ id, ticker })` is the one-call form for token rows and approval cards; a listed mint is answered from the registry alone, any other mint is judged by what it claims on Jupiter, falling back to the local ticker offline. The tiers are the chain-agnostic `TokenVerification` type.

The symbol normaliser behind the counterfeit heuristic moves to `@vultisig/core-chain/coin/tokenSymbol` as `normalizeTokenSymbol`; `chains/ton/jetton/symbol` keeps exporting `normalizeJettonSymbol` as an alias. `coin/jupiter/api` gains `getJupiterTokens` (batched, keyed by mint, filtered to the mints asked for) and `getJupiterVerifiedTokens`, `SolanaJupiterToken` carries Jupiter's `isVerified` flag and `tags`, and `coin/coingecko/getCoingeckoId` gains the batched `getSolanaCoingeckoIds`. `getSolanaTokenMetadata` now fails with a clear error for a mint Jupiter does not index instead of a `TypeError`.
