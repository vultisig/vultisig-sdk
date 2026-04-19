---
'@vultisig/core-chain': minor
---

feat(chain/cardano): CIP-30 CBOR helpers and a reusable submit helper

Adds primitives needed by CIP-30 dApp-wallet bridges on top of `@vultisig/core-chain`:

- `chains/cardano/cip30/cardanoAddressBytes` — decode a Cardano bech32 address into raw bytes (CIP-30 carries addresses as hex of these bytes, not bech32).
- `chains/cardano/cip30/cardanoTxBodyHash` — blake2b-256 of the transaction body, extracted from the full tx CBOR **without re-encoding** so the txid matches what dApps sign off on.
- `chains/cardano/cip30/buildCardanoValue` / `encodeCardanoValue` — build and CBOR-encode a Cardano `value` (coin + multiasset) for `getBalance()`.
- `chains/cardano/cip30/encodeCardanoUnspentOutput` — CBOR-encode a `transaction_unspent_output` for `getUtxos()`.
- `chains/cardano/cip30/buildCardanoWitnessSet` — CBOR witness set returned by CIP-30 `signTx`.
- `chains/cardano/cip30/buildCoseStructures` — CIP-8 / COSE_Sign1 + COSE_Key builders for `signData`.
- `chains/cardano/cip30/cardanoCborPrimitives`, `cborEncoder`, `cborSkip` — minimal, Cardano-correct CBOR primitives (hand-rolled for the integer/bytes-keyed maps that `cbor-x` can't produce, and a byte-range walker used by `cardanoTxBodyHash`).
- `chains/cardano/submit/submitCardanoCbor` — low-level Cardano broadcast helper that exposes `{ txHash, errorMessage, rpcErrorCode, rawResponse }` so callers can distinguish already-committed (Ogmios code 3117), mempool conflicts, etc.

The existing `broadcastCardanoTx` resolver is refactored to delegate to `submitCardanoCbor`, preserving the already-committed fallback behavior.
