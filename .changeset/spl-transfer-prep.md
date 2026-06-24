---
'@vultisig/sdk': minor
---

Add `sdk.prep.splTransfer` (`buildSplTransfer`): a pure-crypto, ATA-aware Solana SPL token-transfer instruction builder. Deterministically derives the sender + recipient Associated Token Accounts and builds an unsigned `transferChecked` instruction (legacy Token Program + Token-2022). Never signs and never broadcasts — the recent blockhash, recipient create-ATA, and signature stay on-device in `vault.sign`. Exported from the top level, `tools/prep`, and the React Native entry.
