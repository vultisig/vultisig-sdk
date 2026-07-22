---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

fix(sdk): raw broadcast paths fail closed instead of reporting false success

Three raw-broadcast/status hardening fixes, all fail-closed (throw/pending on
ambiguity, never fabricate success):

- `RawBroadcastService.broadcastRawTx`: Polkadot/Bittensor no longer return
  `undefined` as a success hash when the RPC response has neither `result`
  nor `error`; Tron now also checks `result === false` (not only `code`),
  matching the guard the core resolver already has; Solana adds a bounded,
  non-blocking signature-status check so a signature the node already knows
  failed is not handed back as a hash. Cosmos and Sui raw paths already had
  assert guards from prior PRs and are untouched.
- `getTronTxStatus` (status resolver): an unrecognized `receipt.result` value
  is no longer narrated as `success` just because it isn't on the known
  failure list - it now resolves to `pending`. `SUCCESS` and absent
  `receipt.result` are unchanged (still `success`).
- `BroadcastService.broadcastTx`: prefers the resolver-returned hash (utxo/
  cardano/tron echo the node's own hash) over a locally re-derived one,
  falling back to the local computation only when the resolver returns none.
