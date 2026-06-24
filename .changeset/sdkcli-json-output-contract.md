---
'@vultisig/cli': patch
---

`agent ask --json` now emits one stable v1 envelope on stdout for both success and error. Previously the success envelope was written through a redirected `console.log` and landed on stderr (stdout empty), and the error path wrote a different flat `{error,code}` shape. The envelope now carries `conversation_id` (success + error) and per-tool-call `id`s, and a mid-stream backend/SSE `error` frame makes the command exit non-zero instead of reporting false success.
