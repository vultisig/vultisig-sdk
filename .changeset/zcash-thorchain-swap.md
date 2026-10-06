---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Offer THORChain for Zcash swaps. ZEC was only quoted through MayaChain, though THORChain runs a ZEC pool. A THORChain swap from Zcash signs like the other UTXO sources: a send to the inbound vault with the memo in OP_RETURN. THORChain publishes that vault as a ZIP-320 TEX address (`tex1…`). WalletCore parses it to the same P2PKH script as its `t1…` form, so the signature matches iOS and Android, which convert the address before signing.
