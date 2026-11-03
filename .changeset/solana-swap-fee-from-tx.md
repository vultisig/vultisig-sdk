---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

The network fee of a Solana aggregator swap (Jupiter, LI.FI, SwapKit) now comes from the provider's own transaction. The swap is signed as the provider built it, with only the blockhash replaced, so its ComputeBudget instructions set what the network charges. `getSolanaFeeAmount` used to quote the chain-specific priority fee instead, a flat 105,000 lamports for every swap. A recorded LI.FI SOL → USDC swap that mainnet charges 48,423 lamports now quotes 48,423. Sends, deposits and THORChain/Maya swaps from Solana are unchanged. New export: `getSolanaMessageFee` from `chains/solana/computeBudget`, which also now holds the ComputeBudget argument readers the Kamino decoder uses.
