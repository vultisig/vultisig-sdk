---
"@vultisig/core-chain": major
"@vultisig/sdk": patch
---

Sign QBTC claims over the BIP-137 claim message (btcq-org/qbtc#210). `computeClaimMessageHash({ chainId, bitcoinAddress, qbtcAddress })` now returns the "Bitcoin Signed Message" digest of `qbtc-claim-v1|<chain-id>|<bitcoin address>|<destination qbtc address>` and accepts P2PKH and P2WPKH addresses only. `computeAllClaimHashes`, `computeAddressHash`, `computeQbtcAddressHash`, `computeChainIdHash`, `btcAddressTypeCircuit` and `QbtcClaimCircuit` are removed. `generateClaimProof` requires `bitcoinAddress` and no longer returns `message_hash`, `address_hash` or `qbtc_address_hash`. `buildClaimTxBody` drops those three fields, which `MsgClaimWithProof` now reserves.
