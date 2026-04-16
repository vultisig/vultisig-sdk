---
'@vultisig/cli': patch
'@vultisig/sdk': patch
---

feat(cli): structured machine-readable errors for agent ask, pipe, and executor

- `agent ask --json` failures include stable `code` with existing `error` string
- NDJSON pipe `error` events and failed `tool_result` lines include `code`
- executor `ActionResult` failures carry `AgentErrorCode`; SSE errors accept optional backend `code`
- document error codes in CLI README
