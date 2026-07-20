---
'@vultisig/cli': patch
'@vultisig/sdk': patch
---

Two CLI developer-experience fixes:

- Silence the `bigint: Failed to load bindings, pure JS will be used` warning that
  `bigint-buffer` printed to stderr on every invocation, including `--version`. It
  warns at module load, before any flag has been parsed, so it cannot be gated behind
  `--debug`; it is silenced with a `yarn patch`. The SDK's node bundle inlines the
  patched copy, which is why `@vultisig/sdk` is bumped here too.
- Generate shell completion from the Commander command table and the SDK chain
  registry instead of a stale hardcoded list, which was missing eleven commands
  (sign/broadcast/tx-status/execute/discount/agent/auth/delete/join/rujira/add-mldsa)
  and 17 of 38 chains.
