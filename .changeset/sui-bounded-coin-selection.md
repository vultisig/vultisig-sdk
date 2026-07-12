---
"@vultisig/core-mpc": patch
"@vultisig/sdk": patch
---

Sui sends now use bounded deterministic coin selection matching iOS #4734 / Android #3989: the fewest largest objects covering the send (capped at 255, balance desc / objectID asc tie-break), a gas object that actually covers the budget (smallest covering, largest fallback) instead of an arbitrary first object, and a bounded keysign payload (covering subset + top gas candidates) so dusty wallets no longer overflow the relay payload or Sui's transaction size limits. Coin-type matching is normalization-aware (short 0x2 vs long-form package addresses).
