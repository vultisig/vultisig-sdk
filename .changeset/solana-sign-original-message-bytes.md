---
"@vultisig/core-mpc": patch
"@vultisig/sdk": patch
---

Sign dApp-supplied raw Solana transactions over their original message bytes instead of a WalletCore re-encode. The signSolana path previously routed raw transactions through TransactionDecoder + SigningInput.rawMessage, letting WalletCore re-encode the message to form the ed25519 pre-image - not guaranteed byte-identical for v0+ALT transactions across WalletCore versions, which breaks mixed-vault co-signing with iOS/Android (which already sign the original bytes, ios#4419 / android#5223). The signature is now spliced into the original transaction bytes at the fee-payer slot for assembly.
