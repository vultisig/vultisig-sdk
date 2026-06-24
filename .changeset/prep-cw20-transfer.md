---
'@vultisig/sdk': minor
---

Add `sdk.prep.cw20Transfer` (`buildCw20TransferMsg`): a pure-crypto builder for
an UNSIGNED CosmWasm CW-20 token transfer `MsgExecuteContract` amino message.
Validates recipient/contract/sender bech32 (HRP match, validator-key reject,
20/32-byte payload), rejects native bank denoms and non-positive/non-integer
amounts, and emits `{ transfer: { recipient, amount } }` ready to feed into
`prepareSignAminoTxFromKeys`. Zero network I/O — never signs, never broadcasts.
