---
"@vultisig/cli": patch
---

feat(cli): sign Polymarket flat-tx-builder outputs like the mobile app

The headless CLI now signs the Polymarket flat-transaction builders
(`polymarket_deposit` approve/wrap and `polymarket_setup_trading`) the same way
the mobile app does — by reading the flat `{chain, chain_id, to, value, data}`
envelope off the `tool-output-available` channel for an allowlist and feeding it
into the existing `onTxReady → storeServerTransaction → sign` pipeline. The only
intended difference from mobile is that the CLI auto-signs (under `--yes` / a
cached password) instead of asking for a device tap.

These tools deliberately do not set `producesCalldata` (so the backend emits no
`tx_ready` frame for them); this is a CLI-only consumer of the flat envelope
that is already on the wire, with zero agent-backend / mcp-ts change.

- Guards every non-transaction result (`no_op`, `insufficient_usdce`, errors,
  wrong/disagreeing chain) so only a real flat tx is ever signed.
- Maps the bundled deposit approve→wrap envelope (`needs_approval` +
  `approval_tx`) onto the executor's existing two-leg machinery so the approve
  is confirmed (receipt-wait) before the wrap — never shipped as a single tx.
- Enforces first-wins per turn so a second signable frame in one turn can never
  silently overwrite (and drop) the first.
- A parity test pins the CLI allowlist to the mcp-ts m7 source of truth.
