---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

A SwapKit Bitcoin PSBT carrying an input this vault cannot sign is now refused before the keysign ceremony, on the initiator and on every co-signer. `compileSignBitcoinTx` gives such an input an empty witness and still returns a complete-looking transaction, so the route signed it, broadcast it and let the network reject it after the user had already approved. The dApp `signPsbt` route is unaffected: its PSBTs may legitimately hold inputs owned by someone else and are returned partially signed rather than broadcast.
