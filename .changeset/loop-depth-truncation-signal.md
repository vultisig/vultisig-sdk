---
'@vultisig/cli': patch
---

agent: surface a loop-depth overrun as a typed `LOOP_DEPTH_EXCEEDED` error instead of a success-shaped `done`.

When the agent message loop exceeds `MAX_MESSAGE_LOOP_DEPTH` (16), `processMessageLoop` previously cleared the queued tool results and called `ui.onDone()` — the same callback used on a clean finish — so a headless caller (`agent ask --json` / `--via-agent` pipe) could not distinguish a depth-capped truncation from a completed turn. It now emits `AgentErrorCode.LOOP_DEPTH_EXCEEDED` via `ui.onError` first (ask exits non-zero with an error envelope; pipe gets a typed `error` frame), then `onDone()` as the turn terminator.
