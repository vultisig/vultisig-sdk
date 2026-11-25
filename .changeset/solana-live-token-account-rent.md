---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Solana fees for sends and swaps that create a token account now use the live rent instead of a hardcoded 2,039,280 lamports. Mainnet `getMinimumBalanceForRentExemption(165)` returns 1,488,440 since SIMD-0437, so those fees reserved 550,840 lamports (27%) more than needed. The new `getSolanaTokenAccountRent()` (`@vultisig/core-chain/chains/solana/tokenAccountRent`) reads the value through the Solana RPC and caches it for an hour. If the read fails it falls back to `solanaConfig.ataRentLamports`, which is an upper bound on the live value. It is used by `getSolanaFeeAmount` (SPL sends to a recipient without a token account), the Jupiter quote (fee account creation) and the LI.FI quote, including the React Native build (destination token account injection).
