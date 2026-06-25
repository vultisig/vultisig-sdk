---
'@vultisig/cli': patch
---

Add a configurable request timeout to all agent-backend HTTP calls in the CLI. A stalled TCP connection (half-open socket, hung load balancer, dropped packets) previously left `vsig agent` invocations hanging forever in headless/CI runs. Every unary fetch (auth, health, conversations, delete, messages-since) and the initial connect of the SSE message stream are now bounded by `AbortSignal.timeout` (default 30s, overridable via `VULTISIG_HTTP_TIMEOUT_MS`). A timeout surfaces as a clear, catchable `request timed out after Nms` error; caller-supplied cancellation signals are preserved.
