---
'@vultisig/cli': patch
---

Agent: emit a structured `TOOL_UNSUPPORTED` error code when the backend asks the CLI to run a client-side tool it doesn't implement, so the backend/LLM can branch (pick an alternative) instead of retrying an unsupported tool. The human-readable stderr line and `error` string are preserved.
