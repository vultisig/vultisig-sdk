---
'@vultisig/sdk': patch
---

Reject malformed UTXO balance responses, provider error envelopes, mismatched addresses, and unsupported numeric encodings instead of reporting a zero or truncated balance. Preserve exact large integer balances and explicit null/zero responses.
