---
"@vultisig/core-chain": patch
"@vultisig/sdk": patch
---

Net Solana Blockaid simulation diffs by resolved mint (native SOL and the WSOL mint share a bucket) before classifying the result as a `swap` or `transfer`. The wrap-then-spend case previously surfaced as a bogus "SOL to WSOL swap" whose destination amount was only the token account's rent-exempt residual, at up to ~29x smaller than the amount actually leaving. The reverse unwrap/close-account case now rejects the receive-only result instead of inventing a transfer. The parser now nets same-mint legs and only classifies as a swap when two distinct mints remain.
