---
"@vultisig/sdk": patch
"@vultisig/core-chain": minor
"@vultisig/core-mpc": patch
---

Check the router minimum, final output asset, and receiver against the quoted swap immediately before EVM keysign payload construction for 1inch, Kyber, and same-chain LI.FI selectors that expose those fields. Reject 1inch and Kyber partial-fill calldata because its proportional floor does not guarantee the quoted absolute output. Packed-pool 1inch selectors retain a minimum and recipient check, but their hidden final asset remains unverified. Unsupported selectors and LI.FI bridge routes remain available and retain the aggregator trust boundary.
