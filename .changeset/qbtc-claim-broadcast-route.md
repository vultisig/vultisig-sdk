---
'@vultisig/core-chain': minor
---

qbtc: `generateClaimProof` now accepts an optional `broadcast: boolean` input. When set, the proof service signs and broadcasts the resulting `MsgClaimWithProof` itself (via its pre-funded broadcaster account) and returns `tx_hash` in the response. Intended for first-time claimers whose own bech32 address doesn't exist on-chain yet, so they can't produce a SignDoc the chain will accept. Server-side broadcasting is wired up in [btcq-org/qbtc#158](https://github.com/btcq-org/qbtc/pull/158).
