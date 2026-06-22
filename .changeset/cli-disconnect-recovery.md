---
'@vultisig/cli': patch
---

Recover the assistant answer (and any tx_ready signable card) when an agent SSE stream drops mid-turn. The backend keeps processing on a detached context and persists the message, so on a transport disconnect the CLI now polls `/messages/since` (server-clock anchored via `X-Server-Now`, opaque-cursor round-trip, bounded retries) to recover what the dropped stream missed instead of losing the turn. A recovered tx_ready flows through the same confirm/sign gate as a live one. Pipe mode emits a `reconnecting` event so agent consumers can distinguish "still working" from "failed"; a deliberate Ctrl+C abort is unaffected.
