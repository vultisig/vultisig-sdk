---
"@vultisig/core-mpc": patch
---

fix(core-mpc/cardano): throw a clear error when a Cardano memo is provided

Until CIP-20 auxiliary-data support lands (see vultisig/vultisig-sdk#432),
`getCardanoSigningInputs` would silently drop `keysignPayload.memo` and
produce a signed Cardano transaction with `auxiliary_data = null` — the
memo never made it on-chain (e.g. tx
`9c8549aea24106c699fffe74c7ded7186c25c390b33415853a83b0781efe4efe`).

The resolver now fails fast with an explanatory error so callers (direct
send, deposit, `VaultBase.send()`, `prepareSendTxFromKeys`, CLI/MCP) can
surface the limitation to the user instead of issuing a tx that loses
their memo. The CIP-30 path (`cardanoCip30.ts`) is unaffected — it signs
the dApp-provided tx body hash and does not read `keysignPayload.memo`.
