---
'@vultisig/core-mpc': patch
---

Re-run the aggregator swap fund-safety guards at the signing-input choke point (`getEncodedSigningInputs`), not only at quote-fetch. A co-signer that receives a hand-built `KeysignPayload` over the relay now validates the 1inch/Kyber router (and the ERC-20 approval spender that trails it) and the Jupiter Solana instruction set against the same allow-lists before contributing a signature, closing the blind-sign gap where the payload the co-signer signs never passed the quote-time guard.
