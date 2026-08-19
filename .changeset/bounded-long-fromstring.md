---
"@vultisig/sdk": patch
---

Route Sui/Tron/Ripple/Cardano signing-input uint64 fields through a bounded `Long.fromString` helper that rejects negative, fractional, or out-of-64-bit-range values instead of silently two's-complement wrapping them before MPC signing.
