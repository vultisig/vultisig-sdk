---
"@vultisig/cli": patch
---

feat(cli): read signable tool outputs off `tool-output-available` with a tx_ready parity cross-check

Generalizes the Polymarket flat-tx-builder bridge into a client-side tool-output
signing + parity layer, the same mechanism the mobile app uses: the CLI derives
a signable candidate from the raw `tool-output-available` envelope (client-side
enrichment — a 1:1 port of the backend's `enrichBuildResult` flat→nested wrap
plus the approve→main split), and cross-checks it against the backend `tx_ready`.

- The backend `tx_ready` stays authoritative for signing whenever it is signable
  (unchanged behavior). The client-side candidate is the parity reference, and
  the sign source only when no usable `tx_ready` arrives — flat off-chain tools
  that emit no `tx_ready` (`polymarket_deposit`, `polymarket_setup_trading`), and
  flat tools whose `tx_ready` is structurally unsignable (`build_custom_*`, which
  use divergent `to_address`/`calldata` field names normalized client-side).
- Parity cross-check: when both channels produce a payload for a turn, their
  `{to, value, data, chain, chain_id, tx_encoding, amount, memo}` leg tuples are
  compared and any divergence is logged loudly (`[parity][DIVERGENCE] …`).
- Guards every non-transaction result (`no_op`, `insufficient_*`, errors,
  missing/disagreeing chain) so only a real tx is ever signed; the chain guard is
  generalized past Polygon to any supported EVM chain (fail-closed on a
  missing/inconsistent chain — never defaults to a chain).
- Maps a bundled approve→main envelope onto the executor's existing two-leg
  machinery so the approve is confirmed (receipt-wait) before the main tx.
- First-wins per turn: a second signable frame can never silently overwrite the
  first; the deferral is reported.

Zero agent-backend / mcp-ts change; entirely within `clients/cli`.
