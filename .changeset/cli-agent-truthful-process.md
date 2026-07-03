---
'@vultisig/cli': minor
---

Make the `agent ask` process truthful and idempotent around broadcast (fund-safety, audit F1/F3/F14).

- **Broadcast-before-ack truthfulness (F1):** a throw AFTER a tx broadcast (the follow-up `recent_actions` report failing) now exits with a distinct `ACK_FAILED` code (8) instead of a generic error — the emitted tx hash is valid and carried in the envelope, so a headless caller knows NOT to blindly retry (which would double-spend).
- **Persistent broadcast journal (F1/F14):** every broadcast is recorded to `~/.vultisig/broadcasts.jsonl` (intent fingerprint, hash, chain, ts). If an identical intent was broadcast in the last 10 minutes and hasn't definitively failed, signing is refused (exit 4) to prevent a double-broadcast on a retry in a fresh process. Multi-leg approve legs are journaled too. Pass `--force` to override.
- **Exit-code taxonomy (F3):** SSE/backend `error` frames and thrown errors now map onto the typed `ExitCode` taxonomy (network/auth/invalid-input/…) instead of a blanket `0`/`1`, and the codes are documented in `agent ask --help`.
