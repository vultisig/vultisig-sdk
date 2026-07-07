---
"@vultisig/cli": minor
---

feat(cli): surface a typed turn-outcome for `agent ask` (success / blocked / refusal / error)

The CLI now advertises the `turn_outcome` surface and parses the backend's
`data-turn_outcome` SSE part, so a headless `agent ask` caller can tell four turn
endings apart WITHOUT parsing prose:

- **success** — the turn completed normally
- **blocked** — a fund-safety guardrail deliberately blocked the requested action
- **refusal** — the model refused or asked a clarifying question (no action taken)
- **error** — an infrastructure error ended the turn

Two additive surfaces:

- `agent ask --output json` gains a top-level `outcome` field
  (`{ kind, code?, detail? }`) on both the success and error envelopes. Human
  output prints a greppable `outcome:<kind>[:<code>]` line for non-success turns.
- New dedicated exit codes (additive; the 0–9 taxonomy is unchanged):
  `10` = a fund-safety block, `11` = a refusal/clarifying question. A frame-less
  infrastructure error now exits `1` instead of a false `0`. Success stays `0`.

Behavior change to note: a turn the backend BLOCKS or the model REFUSES previously
exited `0` (indistinguishable from success); it now exits `10`/`11`. Scripts that
treated every `agent ask` as success-on-0 should branch on `outcome.kind` (or the
exit code). Against an older backend that does not emit `data-turn_outcome`, the
`outcome` field is absent and exit codes are unchanged.
