---
'@vultisig/cli': patch
---

fix(agent): `agent ask` without `--yes` now reports the proposed transaction instead of a failure

`agent ask --help` documents the no-`--yes` path as read-safe: "it reports the
proposed transaction so a read-only prompt can't move funds." It did not. The
transaction built fine, the confirm gate correctly denied signing, and the
refusal was then fed back into the model loop — which retried, failed, and ended
the turn with `transactions: []`, `cards: []`, no proposed transaction, and a
stated cause that was wrong: that the build had errored, that there was no send
tool, or that a broadcast could not be confirmed. Nothing had ever been
authorized to broadcast.

Refusing to sign without `--yes` was always right. Discarding the built
transaction and reporting the refusal as a failed build was the defect.

In ask mode a declined signing now ENDS the turn — the gate there is a fixed
policy, not something a retry can satisfy — and the built, unsigned transaction
is surfaced as the turn's result: `proposed_transaction` (tool, summary, chain)
plus `confirmation_required` on the JSON envelope, and `proposed:` /
`confirmation-required:` lines on the human output. The exit code stays 12
(`CONFIRMATION_REQUIRED`), the same slot `send` and `swap` already use for
"needs `--yes`", and the error message now states what actually happened. This
covers `sign_typed_data` (e.g. a Polymarket bet) as well as `sign_tx`.

Results of client-side tools that already RAN in the same turn (`vault_chain`,
`vault_coin`, `address_book`) stay queued across the decline, so a committed
local mutation is still reported to the backend on the next request.

The TUI and pipe mode are unchanged: the discriminator is policy-vs-decision, not
headless-vs-interactive. Ask mode's gate is a constant; the TUI prompts a live
user and pipe mode blocks on a live host answer over stdin — there a decline is a
real decision the model should still get to acknowledge.

Also maps a backend turn outcome of `confirmation_required` onto exit 12 rather
than the generic safety-block exit 10.
