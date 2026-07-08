---
"@vultisig/cli": patch
---

fix(cli): fail closed on interactive prompts in non-TTY sessions instead of corrupting stdout. A piped/redirected stdout is the machine-output (JSON) channel, but bare `send`/`execute`/`swap`/`tokens --add`/`join`/`rujira swap`/`rujira withdraw` and the password/seedphrase prompts still rendered an inquirer prompt there and then died with a generic `UNKNOWN_ERROR`/exit 7 (or, for `completion --install`, a raw `ERR_USE_AFTER_CLOSE` readline stack trace).

The session is now treated as non-interactive whenever stdout OR stdin is not a TTY — mirroring how `--output` already defaults to `json` when stdout isn't a TTY, and closing the fund-safety gap where a piped `y` could otherwise auto-confirm a signing prompt. In that mode the confirm gates fail fast with a stable `CONFIRMATION_REQUIRED` code (exit 12) and a clear stderr hint *before* any prompt is drawn. All interactive prompts (including the create/import/verify/reshare/settings and interactive-shell paths) are routed to stderr so they can never land on the machine-output channel, `completion --install` and `-i` refuse to run without a TTY with a graceful message, and the rujira swap/withdraw flows now unlock the vault only after the confirmation gate. `--yes`/`--confirm` and real interactive TTY use are unchanged.
