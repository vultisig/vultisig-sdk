---
'@vultisig/sdk': patch
---

Retry transient `429`s from the shared Jupiter proxy in `buildJupiterSwapTx`. The SDK helper was single-shot, so one rate-limited response from `api.vultisig.com/jup` failed the whole swap immediately - while agent-backend-ts already carried bounded retry logic locally. A consumer deleting its backend-local Jupiter copy in favour of the SDK helper therefore regressed transient-proxy handling. Now retries a `429` up to twice with a short linear backoff; other statuses are still surfaced immediately, since a 4xx/5xx will not heal by re-asking.
