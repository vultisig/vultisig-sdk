---
'@vultisig/sdk': minor
---

Add `prepareJettonTransferTxFromKeys` — a vault-free prep helper that builds an
UNSIGNED TON Jetton (TEP-74) transfer from raw vault identity (public keys only,
no key shares). Sibling of `prepareSendTxFromKeys` / `prepareSwapTxFromKeys`.
Wraps the pure `@ton/core` cell builder: emits the `transfer` opcode
(`0xf8a7ea5`), routes the internal message to the sender's Jetton wallet, sets
`response_destination` to the sender (excess-TON refund), and returns
`{signingHashHex, unsignedBocHex, fromAddress, finalize(sigHex)}`. Never signs,
never broadcasts. Also exported from the React Native entry point.
