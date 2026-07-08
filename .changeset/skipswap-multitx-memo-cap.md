---
"@vultisig/sdk": patch
---

Fix `runSkipSwap`'s cosmos memo-length preflight to check every leg of a Skip route, not just the first leg of single-tx routes. Previously the check only ran when the route required a single signature and only inspected the first cosmos leg's memo — a multi-tx route (`allowMultiTx: true`) with an over-cap memo on a later leg sailed through undetected and would fail at broadcast (sdk error code 12, "memo too long") after signing, burning the MPC ceremony. This mirrors a check already present and more thorough in agent-backend-ts's own Skip integration.
