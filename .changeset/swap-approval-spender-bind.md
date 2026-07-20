---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
---

Bind the ERC-20 approval spender to the verified swap router on the co-signer signing-input path for enforced aggregator providers (1inch/kyber). Follow-up to the signing-path router guard: `quote.tx.to` was re-asserted, but `erc20ApprovePayload.spender` is a separate wire field the approve resolver reads verbatim, so a payload could pass the router check yet still carry an approve granting an attacker an allowance (approval-drain). The bind runs in the approve branch (where the field is still present) and requires `spender === quote.tx.to` for enforced providers; unenforced providers stay unbound (notably cowswap, whose spender is legitimately the GPv2VaultRelayer, not `tx.to`). Monotonic gate: throws or no-ops, never mutates signed bytes. Initiators set the two equal by construction, so only a hand-built/tampered payload trips it.
