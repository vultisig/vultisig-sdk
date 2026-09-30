---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

A SwapKit Bitcoin PSBT carrying an input this vault cannot sign is now refused before the keysign ceremony, on the initiator and on every co-signer. `compileSignBitcoinTx` gives such an input an empty witness and still returns a complete-looking transaction, so the route signed it, broadcast it and let the network reject it after the user had already approved. Every input is checked against the vault's own address rather than the PSBT's `isOurs` flag, which `buildSignBitcoinFromPsbt` derives from BIP-32 data and defaults to true for every input when a PSBT carries none. The dApp `signPsbt` route is unaffected: its PSBTs may legitimately hold inputs owned by someone else and are returned partially signed rather than broadcast.
