---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

A Jupiter swap quote no longer counts the fee account's rent in its network fee when that account already exists. The quote used to add 2,039,280 lamports (~0.002 SOL) whenever a platform fee was charged, but the prepended create instruction is idempotent and pays rent only the first time a fee account is made for a given fee owner and output mint. `getJupiterSwapQuote` now reads the account while the `/swap` request is in flight and adds the rent only when the account is missing; if that read fails or gets no answer within 20 seconds, the rent stays in, so the estimate errs high. The transaction itself is unchanged.
