---
'@vultisig/core-mpc': minor
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

Rebroadcast Solana transactions until they confirm or their blockhash expires, and report an expired transaction as `expired` instead of polling it as pending forever.

`SolanaSpecific` gains `optional uint64 last_valid_block_height = 7` (vultisig/commondata), recorded by the chain-specific resolver next to the blockhash. `getKeysignLastValidBlockHeight` reads it back off a payload.

The Solana broadcast resolver now resends the same signed bytes every 2 s while the signature is unseen, stopping at a confirmed sighting or once the chain's block height passes the payload's deadline (bounded by the newest blockhash's deadline when a payload predates the field). A miss fails with `SolanaBlockhashExpiredError` (`recovery: 'resign'`), exported from the SDK root with `toSolanaBlockhashExpiredError`, so a wallet can ask for a fresh signing ceremony rather than retrying dead bytes. That verdict requires a successful history lookup proving the signature never landed; when the lookup itself fails, accepted bytes stay pending for the status poll instead, so a transfer that landed while the status RPC was down is never reported as safe to re-sign. Broadcast resolvers accept an optional `lastValidBlockHeight`, which `BroadcastService` passes from the payload.

The Solana status resolver returns `expired` (not `not_found`) for an unseen signature past `lastValidBlockHeight`; `pollTxStatusUntilFinal` and `verifyBroadcastByHash` forward the deadline.
