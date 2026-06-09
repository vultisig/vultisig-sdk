---
"@vultisig/core-chain": minor
"@vultisig/core-mpc": minor
"@vultisig/sdk": patch
---

Add Blockaid Sui transaction simulation support. The existing Sui Blockaid
scan resolver only requested `validation`; this exposes the simulation block
returned by the same `/sui/transaction/scan` endpoint via a new
`getSuiTxBlockaidSimulation` resolver and a `parseBlockaidSuiSimulation`
parser that produces a UI-facing `{ swap } | { transfer }` headline
(mirroring the Solana shape). `OtherChain.Sui` is now a member of
`blockaidSimulationSupportedChains`, with a new `getTxBlockaidSimulation`
overload, and the mpc package gains a matching
`getSuiBlockaidTxSimulationInput` for the `KeysignPayload`-driven flow.

The parser keeps `null` as its failure mode rather than throwing — Blockaid
field renames degrade to "no preview" instead of breaking consumers.

Closes #671
