---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Solana: a broadcast the node rejects in preflight now reports why. The node puts the reason (`BlockhashNotFound`, `AccountNotFound`, an instruction error) only in `data.err`, which `@solana/web3.js` drops, so every rejection read `Simulation failed. Message: Transaction simulation failed. Logs: []`. Sends now go through `sendSolanaTransaction`, which keeps it: the error reads `Transaction simulation failed: BlockhashNotFound`, with the program logs in `logs`. A stale blockhash therefore takes the resend path and ends in `SolanaBlockhashExpiredError` (`recovery: 'resign'`) instead of a generic rejection, and a duplicate send (`AlreadyProcessed`) is accepted as idempotent, in both `broadcastTx` and `broadcastRawTx`.
