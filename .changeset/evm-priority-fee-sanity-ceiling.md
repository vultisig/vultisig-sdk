---
'@vultisig/sdk': patch
---

fix(evm): sanity-cap RPC-reported priority fee (SDK2-01). EVM fee estimation trusted `maxPriorityFeePerGas` from the RPC verbatim into the signed tx (Solana already had a ceiling for this, EVM didn't) — a compromised or anomalous RPC could inflate it and drain the user's balance to gas. Added a generous per-chain sanity ceiling (`clampEvmPriorityFee`) that only fires on orders-of-magnitude inflation; normal congestion on any chain passes through unchanged.
