---
"@vultisig/lib-utils": patch
"@vultisig/core-mpc": patch
"@vultisig/sdk": patch
"@vultisig/cli": patch
---

Reject missing and malformed amounts before constructing Tron TRC20, Solana, Polkadot, Bittensor and Ripple issued-currency signing inputs. Preserve explicit zero trust-line limits and encode Solana amounts as unsigned uint64 values without overflow.
