---
'@vultisig/cli': minor
---

Harden agent channels with an SSE frame-idle timeout, backend/profile-scoped token caching, protocol-drift warnings, and explicit Polymarket auto-submit authorization.

**Behavior change — auto-submit is now opt-in.** Backend-requested Polymarket order submission previously flowed by default; it now requires the new `--allow-auto-submit` flag. Without it the CLI strips the submit markers and forces `auto_submit=false`, so a script that relied on `--yes` alone to place an order will sign and exit 0 without submitting. Add `--allow-auto-submit` to restore the old behavior.

Also: the agent token cache is re-keyed by (vault, backend URL, profile), so cached credentials from a previous version are dropped and the next run re-authenticates. New `VULTISIG_SSE_IDLE_TIMEOUT_MS` env var (default 60s) bounds an established but silent SSE stream; `agent ask --output json` may now carry an additive `warnings` field.
