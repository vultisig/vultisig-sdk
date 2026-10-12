---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Sign dYdX governance votes as a `MsgVote`. A keysign payload with transaction type `VOTE` and the memo `DYDX_VOTE:<option>:<proposalId>` fell through to a `MsgSend`, so a vote started from the extension or desktop app could never be signed correctly, and an iOS-initiated vote could not be co-signed by them. The Cosmos signer now builds the `MsgVote` with no transaction memo, matching iOS `DydxHelperStruct` byte for byte. A malformed vote memo, or `VOTE` on any other ibc-enabled chain, is refused instead of falling back to a send. `@vultisig/core-chain` exports `toDydxVoteMemo` / `parseDydxVoteMemo` so initiators and signers share one memo format.
