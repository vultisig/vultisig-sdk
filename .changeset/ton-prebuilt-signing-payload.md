---
'@vultisig/sdk': minor
---

Add `buildTonTxFromSigningPayload({publicKeyEd25519, signingPayloadBoc, includeStateInit, workchain})` to sign yield.xyz TON actions whose signing payload BoC is already constructed upstream. Parses the BoC, hashes the payload cell, takes the MPC signature, and wraps the final external message — same `{signingHashHex, unsignedBocHex, fromAddress, finalize(sig)}` contract as `buildTonSendTx`. Accepts either base64 or hex BoC input. Optional `includeStateInit` flag deploys the v4r2 wallet contract alongside the tx for first-send (seqno === 0) scenarios.
