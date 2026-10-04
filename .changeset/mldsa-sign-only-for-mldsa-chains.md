---
'@vultisig/sdk': patch
---

Scope ML-DSA signing to ML-DSA chains. A vault holding an ML-DSA key share ran a
full ML-DSA sign alongside every ECDSA/EdDSA sign, because the trailing blocks in
`ServerManager.coordinateFastSigning` and both `RelaySigningService` signing paths
were gated on `vault.keyShareMldsa` instead of the requested signature algorithm.

That produced an ML-DSA signature over raw message hashes with no QBTC SignDoc
binding and returned it on the public `Signature.mldsaSignature` field, so a
non-QBTC sign could hand back QBTC-authorizing key material. It also cost relay
signers a full `startKeysignWithRetry` cycle on every ordinary sign, and reused the
DKLS session id and encryption key for the ML-DSA round.

ML-DSA now runs only through the dedicated `signatureAlgorithm === 'mldsa'` paths,
and `mldsaSignature` is only ever set from there.
