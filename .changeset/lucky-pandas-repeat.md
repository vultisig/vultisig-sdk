---
'@vultisig/cli': patch
---

Make the agent SSE idle deadline bound a hung backend, and handle the frame types that carry turn-outcome semantics.

Follow-up to the agent-channel hardening in #1305; both are behavior changes worth reading.

**The idle deadline now measures progress, not traffic.** Keep-alive comments no longer extend it. Both backends emit those from a timer that runs independently of whether the turn is advancing, so a deadline they reset bounded only a dead connection — a backend wedged in a model or tool call kept pinging and `agent ask` hung forever, which is the exact failure the deadline was added to stop. The default rises 60s → 180s to match what it now measures: real backend silence, which a healthy turn is documented to produce for up to ~150s (a model call is bounded at 90s, the swap builder at 90s + 60s MCP). A slow-but-progressing turn still resets the clock on every real frame. `VULTISIG_SSE_IDLE_TIMEOUT_MS` is unchanged, and the timeout still throws a typed `TIMEOUT` → exit 3.

**`tool-output-error` and `text-replace` are now handled.** Both were counted as unknown frames and dropped, and both carry semantics the turn result depends on:

- `tool-output-error` is the backend's tool-failure terminal. Ignored, the call never closed, so a FAILED tool was reported as a running one and the turn recorded no failure. It now surfaces as a failed tool result. It can never produce a signable transaction.
- `text-replace` retracts prose the backend has decided is wrong and supplies a correction. Ignored, the retracted claim stayed as the turn's answer — a turn could answer "I sent your 5 ETH." after the backend had withdrawn exactly that sentence. The correction is now applied, or declined outright if it cannot be applied cleanly, never half-applied.

**`PROTOCOL_DRIFT` warnings are now `--verbose`-only,** and unknown `data-*` card kinds no longer produce them at all. The backend's V1 wire treats unknown data kinds as forward-compatible and emits some from a dynamic call site no static client list can track, so warning by default fired on healthy turns against a newer backend. Automation that read `warnings` for drift will no longer receive it unless `--verbose` is set; the field was already documented as omitted-when-empty. Frames whose absence is a real defect are handled explicitly instead of enumerated.
