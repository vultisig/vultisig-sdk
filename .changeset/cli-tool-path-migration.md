---
'@vultisig/cli': patch
---

Migrate fully to the client-side tool path. The legacy `actions` SSE channel
consumption was dropped in the previous release; this release also deletes
the `executor.dispatch()` chokepoint and the per-tool methods that only the
chokepoint reached. The wire shape (`recent_actions`, `tx_ready`,
`tool-input-available`) is unchanged for users.

Internal: `Action`, `ActionResult`, `SSEActions` types removed;
`SendMessageResponse.actions` and the `actions` SSE event variant removed
from public types. CLI now consumes only `tool-input-available` for
client-side tool calls and `tx_ready` for transaction signing.
