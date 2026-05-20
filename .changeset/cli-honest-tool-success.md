---
"@vultisig/cli": patch
---

agent: report honest tool success instead of a hardcoded `true`

The agent CLI reported every finished server-side tool as `success: true`
regardless of outcome. `session.ts` hardcoded the result and `client.ts`
discarded the `tool-output-available` payload, so a failed `execute_send` /
`execute_swap` (invalid address, insufficient balance, no swap route, signing
failure) surfaced as a success to programmatic consumers (the `--via-agent`
pipe, automation, UI status). The client now derives success from the tool's
output payload (`{"status":"error"}` / `{"error"}` / stringified), passed
through `onToolProgress`; `ok ?? true` keeps the prior optimistic default when
no output is present so older backends cannot regress legitimate successes.
