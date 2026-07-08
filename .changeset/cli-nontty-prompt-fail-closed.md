---
"@vultisig/cli": patch
---

fix(cli): fail closed on interactive prompts in non-TTY sessions instead of corrupting stdout. A piped/redirected stdout is the machine-output (JSON) channel, but bare `send`/`execute`/`swap`/`tokens --add`/`join` and the password/seedphrase prompts still rendered an inquirer prompt there and then died with a generic `UNKNOWN_ERROR`/exit 7 (or, for `completion --install`, a raw `ERR_USE_AFTER_CLOSE` readline stack trace). Piped stdout now implies non-interactive — mirroring how `--output` already defaults to `json` when stdout isn't a TTY — so these commands now fail fast with a stable `CONFIRMATION_REQUIRED` code (exit 12) and a clear stderr hint before any prompt is drawn. All interactive prompts are routed to stderr so they can never land on the machine-output channel, and `completion --install` prints a graceful "requires an interactive terminal" message instead of crashing. `--yes`/`--confirm` and real interactive TTY use are unchanged.
