---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
'@vultisig/cli': minor
---

Add gasless TON jetton sends through the TonAPI relay for W5 accounts. `prepareSendTx`, `send`, `getMaxSendAmount` and the vault-free prep helpers take `tonGasless`/`gasless`; the relay's quote is recorded in `TonSpecific.gasless` (new `TonGasless` message), validated by every signer against the approved transfer before hashing, signed as a W5 `internal_signed` request, and handed to the relay at broadcast. The fee of such a send is the relay commission in the jetton itself — `getKeysignFeeCoin` tells which coin a payload's fee is denominated in — and the status resolver finds the relayed transaction by the signed body's hash. The CLI's `send` command gains `--gasless`. Also fixes the seqno of a deployed W5 wallet: toncenter returns W5 accounts raw, so the seqno is now read from the data cell instead of defaulting to 0, which had every W5 send after the first rejected as a replay.
