---
'@vultisig/core-mpc': minor
---

feat(cardano): attach CIP-20 label-674 metadata when memo is provided

Cardano direct sends with a non-empty memo now embed the memo as
CIP-20 on-chain metadata (`{ 674: { "msg": [...] } }`) instead of
silently dropping it.

Implementation:
- `buildCip20AuxData` encodes the memo into CIP-20 CBOR and computes
  the blake2b-256 aux data hash
- `patchTxBodyWithAuxHash` byte-patches the WalletCore-produced tx body
  to include the auxiliary_data_hash at key 7 (CBOR map header bump)
- `getPreSigningHashes` for Cardano now returns blake2b of the PATCHED
  body when a memo is present, so all MPC devices sign the correct hash
- `compileTx` for Cardano re-derives the pre-signing output, patches
  the body when memo is present, and passes auxDataCbor to
  buildSignedCardanoTx so element [3] carries the metadata
- `getCardanoChainSpecific` bumps the forced fee by 44 * len(auxDataCbor)
  to account for the extra bytes WalletCore cannot anticipate
- Sends without memo are byte-identical to the pre-fix behavior
