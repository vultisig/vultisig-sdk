---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Solana broadcast: surface the on-chain rejection reason. When `sendTransaction` is rejected at preflight, the RPC returns the actionable detail in `data.err` / `data.logs` (the program logs), which web3.js exposes via `SendTransactionError.logs` while leaving the bare `.message` ("failed to send transaction") uninformative. The broadcast resolver now folds those program logs into the thrown error's message (preserving the original error as `cause`), so consumers reading the top-level message see *why* the network rejected the transaction — "insufficient lamports", a custom program error, a failed instruction — instead of just that it failed.
