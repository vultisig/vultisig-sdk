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
- Fail-closed on parity divergence: a flat tool-output candidate is enqueued as a
  sign source only when there is no `tx_ready` at all, or when the same-turn
  `tx_ready` matched parity. A client-derived candidate that is not proven equal to
  a present `tx_ready` (diverged, or unpaired) is never signed — the turn falls
  closed to the `tx_ready` path (a hard error at sign time) instead of signing the
  client-enriched bytes.
- Parity pairing (telemetry only): the two channels are diffed only when they are
  the SAME tool call (paired by tool-call id — the `tx_ready` inherits the id of
  its wire-adjacent tool-output twin), so an unrelated same-turn `tool_output` +
  `tx_ready` pair no longer emits a false `[DIVERGENCE]`. This pairing affects only
  the divergence log; the sign decision above is deliberately independent of it, so
  the fund-safety guarantee rests on parity equality alone, not on the wire-ordering
  invariant.

Zero agent-backend / mcp-ts change; entirely within `clients/cli`.
