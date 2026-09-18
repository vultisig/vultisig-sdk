---
'@vultisig/core-mpc': major
'@vultisig/sdk': patch
---

Regenerate the keysign protobuf types so a custom-message signing request can carry the dApp that asked for it.

`CustomMessagePayload` gains `dappMetadata?: DAppMetadata` (`optional DAppMetadata dapp_metadata = 6` in vultisig/commondata). Until now dApp identity travelled only on `KeysignPayload`, so message signing — `personal_sign`, EIP-712 typed data, Cosmos `signArbitrary`, and the hash-only Cardano `signTx` / `ton_proof` requests — reached co-signing devices with no indication of which dApp asked. The field is optional: leave it unset when there is no dApp, and such a payload encodes to the same bytes as before. All three values are declared by the initiating device and covered by no signature, so treat them as display-only.

**Source-breaking import move for TypeScript consumers.** Both payload kinds now share the type, so upstream moved `message DAppMetadata` into its own `dapp_metadata.proto`. `DAppMetadata` and `DAppMetadataSchema` are no longer exported from `@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb`; import them from `@vultisig/core-mpc/types/vultisig/keysign/v1/dapp_metadata_pb` instead. The old import fails at compile time rather than silently.

Wire compatibility is preserved. `DAppMetadata` keeps its full message name and field numbers, and `KeysignPayload.dapp_metadata` stays at field 50, so existing payloads decode as before. The new `CustomMessagePayload` field is additive: devices on older versions skip it.

`@vultisig/sdk` does not expose these types; it is bumped so its bundled copy of the generated code stays in step.
