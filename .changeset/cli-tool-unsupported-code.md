---
'@vultisig/cli': patch
---

Agent: when the backend asks the CLI to run a client-side tool it doesn't implement, emit a structured `TOOL_UNSUPPORTED` error code (in the failure `RecentAction`'s `data.code`) so the backend/LLM can branch — pick an alternative instead of retrying or waiting on an action that will never report. The CLI now routes SSE `tool-input-available` frames on the backend's full client-side tool contract (a superset of the implemented dispatch registry), so an unimplemented tool reaches the dispatcher and reports `TOOL_UNSUPPORTED` instead of silently degrading to display-only progress. The human-readable stderr line and `error` string are preserved.
