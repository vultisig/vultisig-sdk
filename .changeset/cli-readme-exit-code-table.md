---
"@vultisig/cli": patch
---

docs(cli): regenerate the README "Exit Codes" table from the `ExitCode` enum (the single source of truth in `src/core/errors.ts`). The shipped table was stale and mislabelled every non-zero code — e.g. it called `2` "invalid usage" and `3` "configuration error" when the CLI actually returns `2` for authentication-required and `3` for a retryable network error, so a script written to the README's codes misclassified every failure. Codes `8`–`11` (ACK_FAILED, DUPLICATE_BROADCAST, and the two `agent ask` turn-outcome codes) were also undocumented. Also corrects the "disable colored output" env var to `NO_COLOR` (the cross-tool standard the CLI honours; `VULTISIG_NO_COLOR` still works). Adds a doc-lint test that fails if the README table drifts from the enum. Docs-only, but the README ships in the npm package, so this is a patch.
