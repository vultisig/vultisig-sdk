---
"@vultisig/sdk": patch
---

Reject negative bigint/number inputs in `bigIntToHex`/`numberToEvenHex` instead of silently producing empty bytes, closing a fail-open gap on shared pre-signing amount/nonce/ABI encoding paths.
