---
'@vultisig/sdk': patch
---

Keep every `@bufbuild/protobuf` entry point external in the platform bundles, not just the bare specifier. `@bufbuild/protobuf/wire` (and `codegenv2`, `wkt`) were being inlined, so the bundle carried its own copy of protobuf-es that registered a text-encoding provider — without `encodeUtf8Into` — on the global symbol protobuf-es shares with the consumer's copy. When SDK code ran first (as in a swap, where quotes precede signing) the consumer's newer `BinaryWriter` then failed with `this.encodeUtf8Into is not a function` while encoding the keysign message, and the keysign QR could not be generated.
