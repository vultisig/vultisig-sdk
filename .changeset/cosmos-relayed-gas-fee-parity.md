---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
---

Fix cross-device Cosmos co-signing when a dynamic `CosmosSpecific.gas_limit` is relayed.

`CosmosSpecific.gas` is now unambiguously the FINAL fee amount: the initiator prices it for the gas limit it relays (`priceCosmosFeeForGasLimit`, applied at keysign-payload build time) and every reader spends it verbatim. Previously the TypeScript readers re-scaled `gas` by `relayedGasLimit / staticGasLimit` while the Swift clients (iOS / macOS) signed `gas` unchanged, so the two devices hashed different SignDocs and the joining device failed with "HTTP 404" / "fail to download setup message" when polling `GET /setup-message/{sessionId}`.

Terra Classic hit this on every native send — `/cosmos/tx/v1beta1/simulate` returns ~320k against the 300k static limit, so the scaling branch was always taken (a 20 LUNC fee was signed as 21.379134 LUNC on one side and 20 LUNC on the other).
