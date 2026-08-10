---
"@vultisig/sdk": minor
---

Align React Native XRP and TON transaction-builder signing hashes with WalletCore for mixed-platform MPC ceremonies.

**Consumer-visible behavior changes:**

- **TON Jetton memo capacity narrows and becomes amount-dependent.** Previously any memo up to 123 bytes was accepted. Now `buildTonJettonTransferTx` / `prepareJettonTransferTxFromKeys` throw once the encoded comment no longer fits WalletCore's inline `forward_payload` cell. The exact cap shrinks as the transfer amount grows (larger `storeCoins` encoding leaves fewer bits for the comment) — at most ~34 ASCII bytes for large (e.g. 18-decimal, 1-token) amounts, ~39 bytes for small ones. This is a hard throw, not a truncation.
- **XRP `Memos[].Memo.MemoType` is no longer set.** A Payment memo previously always carried `MemoType: "text/plain"` (hex-encoded); it's now omitted to match WalletCore's raw-JSON memo path byte-for-byte. Anything downstream reading `MemoType` off a Vultisig-built XRP payment will stop seeing it.
