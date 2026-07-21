---
'@vultisig/cli': patch
---

fix(cli): an interactive `send`/`execute`/`swap` decline now exits 12
`CONFIRMATION_REQUIRED` (`success:false` in JSON), matching the non-interactive
refusal, instead of the old swallowed exit 0 that told a scripted caller a declined
transaction had succeeded. A decline inside the interactive REPL still just returns
to the prompt. **Behavior change scripted consumers branch on:** answering "no" at
a confirm prompt flips `$?` from 0 → 12.

Also corrects the ask-mode taxonomy so a persistent auth failure while resuming a
`--session` fails closed as `AUTH_FAILED` (exit 2) rather than `SESSION_NOT_FOUND`
(exit 5).
