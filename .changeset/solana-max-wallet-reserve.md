---
"@vultisig/core-chain": patch
"@vultisig/core-mpc": patch
"@vultisig/sdk": patch
---

Keep the live Solana wallet rent-exempt reserve when calculating native SOL MAX sends. Align estimated priority fees with the transaction's compute budget and round fractional lamports upward.
