---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

feat(ton): jetton auto-discovery with verified / unverified / scam classification

TON wallets get carpet-bombed with counterfeit jettons — fake USDT above all — and until now the SDK could neither find the jettons an address holds nor say which of them to trust: discovery covered EVM, Solana, Cosmos, Cardano and Ripple, and TON shipped nine curated jettons plus manual add. A wallet with no labels cannot protect a user from the most common TON scam.

`findCoins` now supports `Chain.Ton` (`coinFinderChainKinds` gains `'ton'`). `findTonCoins` lists every jetton with a non-zero balance through the Toncenter proxy in one paged call — the indexer's symbol, name, decimals and logo ride along, so there is no follow-up call per jetton — and returns only jettons that pass verification. Curated metadata wins for jettons we ship ourselves.

Verification lives in `@vultisig/core-chain/chains/ton/jetton/verification`. The registry of verified jettons (`chains/ton/jetton/verifiedRegistry`) merges our curated TON tokens with Tonkeeper's community-reviewed `ton-assets` whitelist, fetched once an hour and degrading to the curated list alone when unreachable. `resolveTonJettonVerification` is pure: a listed address is `verified`; an unlisted jetton is `scam` when the indexer flags it or when its symbol or name collapses onto a verified jetton's — `normalizeJettonSymbol` folds `USD₮`, Cyrillic `UЅDT`, `$USĐ₮` and full-width forms onto `USDT` — and `unverified` otherwise. `getTonJettonVerification({ id, ticker })` is the one-call form for token rows and approval cards; it judges the master by what it claims on chain, falling back to the local ticker offline. The tiers are the chain-agnostic `TokenVerification` type in `@vultisig/core-chain/coin/tokenVerification`.

`chains/ton/api` gains `getOwnerJettonWallets` (paged, owner-filtered, one entry per jetton, with embedded master metadata) and `getJettonMastersMetadata` (batched, lenient master lookup keyed by lower-cased raw address), and `chains/ton/address` gains `tonAddressToRawKey`. `vault.discoverTokens(Chain.Ton)` and `Vultisig.discoverTokens` work for TON through the same path.
