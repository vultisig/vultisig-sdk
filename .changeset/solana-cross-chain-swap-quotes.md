---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Fix swap quotes from Solana to another chain (e.g. Solana USDC to Arbitrum USDC), which failed with "no route". LiFi no longer runs the Solana destination-account check on a route whose destination is on another chain, where it decoded the EVM token and recipient as base58 ("Non-base58 character"). SwapKit now accepts NEAR Intents fees, which are charged in the source asset on the NEAR Intents ledger and labelled `chain: NEAR`, instead of rejecting them as an unsupported fee asset. On EVM and transfer-source routes over NEAR Intents (e.g. EVM, BTC or TON sources), SwapKit quotes now show the affiliate and service fee, which were previously dropped as an unresolved fee shape.
