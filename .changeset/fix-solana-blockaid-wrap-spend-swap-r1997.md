---
'@vultisig/core-chain': patch
---

Net Solana Blockaid simulation diffs by resolved mint (native SOL and the WSOL mint share a bucket) before classifying the result as a `swap` or `transfer`. A wrap-then-spend, or an unwrap/close-account, produced an `out` leg on one and an `in` leg on the other for the SAME underlying asset — previously surfaced as a bogus "SOL to WSOL swap" whose destination amount was only the token account's rent-exempt residual, at up to ~29x smaller than the amount actually leaving. The parser now nets same-mint legs and only classifies as a swap when two distinct mints remain.
