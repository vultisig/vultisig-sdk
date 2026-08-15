---
'@vultisig/cli': patch
---

fix(cli): `verify --resend` no longer applies fast-vault CREATE-time validation to existing credentials

Bead 33sz9 (PR #1749) added client-side name/email/password validation to `create fast` so bad input can't provision orphaned server-side vault state. That same strict validation was accidentally wired into `verify --resend` too, which operates on a vault that already exists — a legacy vault created with a password shorter than the current 8-char floor (or an email another Vultisig client accepted at create time) could no longer resend its own OTP through the CLI.

`verify --resend` (both the `--email`/`--password` flags and the interactive prompt fallback) now only requires the credential to be non-empty — the server is the source of truth on whether it's correct, not this CLI's create-time syntax rules.

Also swaps the hand-rolled create-time email regex for `@vultisig/lib-utils`'s shared `validateEmail` as a baseline, layering the fast-vault-specific deliverability rules (TLD required, no dot-adjacent local part, no bare hostname) on top, so the CLI agrees with other Vultisig clients on RFC-shaped syntax while keeping create-time OTP-deliverability guarantees.
