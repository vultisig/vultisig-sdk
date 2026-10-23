---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

A native SOL MAX send no longer fails on-chain when the priority fee moves between the quote and signing. MAX now keeps Solana's rent-exempt floor (890,880 lamports) back, so the sender is never left holding a sub-rent remainder, which the runtime rejects with `InsufficientFundsForRent`. The Solana fee estimate also rounds the priority fee up to a whole lamport, as the runtime does, instead of quoting one lamport short.
