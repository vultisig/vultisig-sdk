---
"@vultisig/core-chain": patch
---

fix(swap/lifi/solana): inject createAssociatedTokenAccountInstruction when SPL-token destination ATA is missing

SOL -> SPL-token swaps via Li.Fi failed simulation with `custom program error: 0x17` when the destination wallet had no Associated Token Account for the output mint (e.g. first-time USDC recipient). LiFi's transaction blob does not include the ATA creation instruction in that case.

This adds a pre-flight RPC check: if the destination ATA is missing, a `createAssociatedTokenAccountIdempotentInstruction` is prepended to the transaction before the quote data is returned. The idempotent variant is safe even if the ATA is created between quote-time and broadcast-time.
