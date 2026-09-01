---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

fix(ton): refuse to build a Jetton transfer when the sender jetton wallet cannot be resolved

A Jetton transfer is a message to the sender's *own* jetton wallet, and that address was resolved with a swallowed failure: `TonSpecific.jettonAddress` starts as `''`, a failed lookup left it `''`, and `''` is not null or undefined, so every presence check downstream waved it through. The result was a signable transaction whose destination was the empty string — a failed network lookup producing a broadcastable transfer that moves nothing.

The chain-specific resolver now throws when the lookup fails or comes back blank, keeping the underlying failure as the error's `cause`. It stays a plain `Error` rather than a `BuildKeysignPayloadError` because an RPC timeout or indexer lag is retryable, not bad user input.

`buildJettonTransfer` rejects a blank jetton wallet address as well, so a payload built elsewhere — an older client, another device in a keysign — cannot get a destination-less transfer signed here either.
