---
"@vultisig/sdk": minor
---

Add `sdk.balance.solana` read-only helpers to the public surface: `getSolBalance(address)` (native SOL — exact u64 lamports via integer/BigInt math, no float corruption) and `getSplTokenBalance(address, mint)` (SPL / Token-2022 — auto-detects the token program, sums balances losslessly across all of the owner's token accounts for the mint). Both are pure RPC reads against the existing Solana proxy and are exported from the node and React Native entrypoints.
