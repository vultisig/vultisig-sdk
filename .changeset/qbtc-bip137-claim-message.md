---
"@vultisig/core-chain": major
"@vultisig/sdk": patch
---

Sign QBTC claims over the BIP-137 claim message (btcq-org/qbtc#210). `computeClaimMessageHash({ chainId, bitcoinAddress, qbtcAddress })` now returns the "Bitcoin Signed Message" digest of `qbtc-claim-v1|<chain-id>|<bitcoin address>|<destination qbtc address>` and accepts P2PKH and P2WPKH addresses only. `computeAllClaimHashes`, `computeAddressHash`, `computeQbtcAddressHash`, `computeChainIdHash`, `btcAddressTypeCircuit` and `QbtcClaimCircuit` are removed. `generateClaimProof` requires a base64 compact BIP-137 `signature` and `bitcoinAddress` and no longer returns `message_hash`, `address_hash` or `qbtc_address_hash`. `buildClaimTxBody` uses the current field numbers: public-key hash at field 4 and broadcaster at field 6. QBTC account numbers and sequences are returned as decimal strings alongside their bigint equivalents, preserving uint64 precision.

Require `bitcoinAddress` when building a claim transaction and encode it at protobuf field 8, matching btcq-org/qbtc#225. It must be the exact P2PKH/P2WPKH address covered by the claim signature and proof.
