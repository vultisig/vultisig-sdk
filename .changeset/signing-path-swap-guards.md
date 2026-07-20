---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Re-assert the aggregator router allow-list (1inch/kyber) and the Solana Jupiter
program + fund-movement guard on the MPC co-signer signing-input path, not only
at quote construction. Every co-signer independently rebuilds the signing input
from the shared KeysignPayload, so a compromised initiator could otherwise hand
a co-signer an unvalidated swap destination (EVM `quote.tx.to`) or a spliced
drain instruction (Solana `quote.tx.data`) and have it signed verbatim. Both
guards are pure gates: they fail closed for enforced providers or no-op, and
never mutate the signed bytes, so cross-device pre-signing hash agreement is
unchanged.
