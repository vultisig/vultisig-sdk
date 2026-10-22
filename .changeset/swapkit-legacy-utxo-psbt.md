---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': patch
---

Sign SwapKit's pre-built DOGE, BCH, DASH and ZEC PSBTs the way iOS and Android do (vultisig-sdk#2460), so an SDK client can co-sign those swaps with a mobile peer and vice versa. DOGE / BCH / DASH PSBTs are hashed with the chain's legacy or fork-id sighash, keeping the PSBT's version and locktime; ZEC PSBTs are signed through WalletCore from a frozen Sapling plan with the live branch id. Every PSBT is bound to the vault's own script and signing key, and the value leaving the vault and the miner fee are capped at the quoted amount. SwapKit quotes for these sources now request the built PSBT, stamp the per-chain `PSBT_*` tx type, and rewrite version-2 legacy PSBTs to version 1 before relaying them.
