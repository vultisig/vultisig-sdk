---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

fix(ton): let a dApp deadline tighten the signed expiry

`getTonChainSpecific` always signed `expireAt = now + 600`, so the `valid_until` a TonConnect `sendTransaction` carries never reached the wallet message: a request with a 60-second window was signed with a ten-minute one, and a broadcast landing after the dApp's window could execute on chain while the dApp already treated it as expired and retried.

`GetChainSpecificInput` now takes an optional `validUntil` (unix seconds) for `tonSpecific`. The signed `expireAt` is `min(now + 600, validUntil)` — the wallet's own window remains the ceiling — and a deadline already in the past fails the build instead of signing a transaction the network would reject. Callers that pass nothing keep the previous behaviour; co-signers read `expireAt` from the payload, so only what the initiator writes changes.

The expiry is computed last, after the seqno, bounceability and jetton-metadata lookups: each is a network round trip, so a deadline still ahead when the build starts can be behind by the time it finishes, and the wallet's own ten-minute window now starts when the payload is finished rather than being partly spent on those lookups.
