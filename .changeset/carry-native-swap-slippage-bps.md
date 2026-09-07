---
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

Carry a native swap's price impact in the keysign payload, so a co-signer can show it.

A device joining a keysign renders its swap verify screen entirely from the `KeysignPayload` — it holds no quote. Price impact was never on the wire, so the initiator showed a `Price Impact` row and the joining device showed nothing, on the screen whose purpose is for both parties to confirm they are approving the same swap.

`THORChainSwapPayload` gains `optional uint32 slippage_bps = 14` (vultisig/commondata#104), and `nativeSwapQuoteToSwapPayload` populates it from `quote.fees.slippage_bps`. MayaChain shares the message, so one field covers both native swap chains.

The value is carried rather than re-derived on the joiner. A joining device has enough in the payload to rebuild the quote request, but pools move between initiating and joining, so a fresh quote returns a different figure — price impact would become the only term on that screen where the two devices legitimately disagree.

The field is optional and left unset when the provider reports no slippage. Payloads from senders that predate it round-trip unchanged, and receivers are expected to hide the row rather than read an absent figure as zero.
